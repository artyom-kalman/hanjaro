import { Bot, webhookCallback } from "grammy";
import { internal } from "./_generated/api.js";
import { type ActionCtx, httpAction } from "./_generated/server.js";
import { allHanja, isHangul, isHanja } from "./chars.js";
import type { DisplayResult, HanjaDoc } from "./hanjaFormat.js";
import { type Lang, t } from "./i18n.js";
import {
	buildLangInitKeyboard,
	buildSettingsKeyboard,
	buildSyllableChoiceKeyboard,
} from "./keyboards.js";
import { searchHanjaExamples, searchWord } from "./krdict.js";
import {
	formatResultWithHanja,
	handleHangulHanjaList,
	handleSingleHanja,
	handleWordLookup,
	krdictToDisplay,
	type LookupDeps,
	runWordLookup,
	type SentMessage,
} from "./lookup.js";
import {
	anyTranslationNeeded,
	computeTranslationNeeds,
} from "./translationNeeds.js";

async function getUserLang(
	actionCtx: ActionCtx,
	userId: number | undefined,
): Promise<Lang> {
	if (userId === undefined) return "en";
	const settings = await actionCtx.runQuery(
		internal.userSettings.getByTelegramUserId,
		{ telegramUserId: userId },
	);
	return (settings?.lang as Lang | undefined) ?? "en";
}

function pickPromptLang(code: string | undefined): Lang {
	return code?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

const HANJA_EXAMPLES_TIMEOUT_MS = 5000;

// Schedules the background orchestrator that edits the result message in place
// once AI translations are ready. No status message — the user sees the
// immediate result, and the same message upgrades when the LLM responds (or
// gains a small failure note on timeout/error). Whether anything is actually
// worth scheduling is the shared decision in translationNeeds.ts, so this never
// diverges from what the orchestrator will do: schedule only when a Hanja gloss
// (RU only), the word translation, or a standalone definition is genuinely
// needed — notably NOT when the sole apparent gap is a definition that Prompt A
// (case 1) would emit anyway. Re-derives everything from targetCode, so the
// scheduled args stay tiny.
async function scheduleTranslationUpgrade(
	actionCtx: ActionCtx,
	resultMsg: SentMessage,
	result: DisplayResult,
	docs: HanjaDoc[],
	lang: Lang,
): Promise<void> {
	const needs = computeTranslationNeeds(result, docs, lang);
	if (!anyTranslationNeeded(needs)) return;

	await actionCtx.scheduler.runAfter(
		0,
		internal.translate.scheduledTranslateAndEdit,
		{
			chatId: resultMsg.chat.id,
			messageId: resultMsg.message_id,
			targetCode: result.targetCode,
			lang,
		},
	);
}

export const handleTelegramWebhook = httpAction(async (actionCtx, request) => {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const apiKey = process.env.KRDICT_API_KEY;
	if (!token || !apiKey) {
		throw new Error("TELEGRAM_BOT_TOKEN and KRDICT_API_KEY must be configured");
	}
	const krdictApiKey = apiKey;
	const bot = new Bot(token);

	async function lookupHanjaExamples(
		character: string,
		lang: Lang,
	): Promise<DisplayResult[]> {
		try {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const examples = await Promise.race([
				searchHanjaExamples(krdictApiKey, character, lang),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Hanja examples lookup timed out")),
						HANJA_EXAMPLES_TIMEOUT_MS,
					);
				}),
			]).finally(() => {
				if (timer !== undefined) clearTimeout(timer);
			});
			if (examples.length > 0) {
				await actionCtx.runMutation(internal.words.saveMany, {
					entries: examples,
					lang,
				});
			}
			return examples.map((r) => krdictToDisplay(r, lang));
		} catch (err) {
			console.error("Hanja examples lookup failed:", err);
			return [];
		}
	}

	// DB/API access injected into the lookup flow (lookup.ts stays free of
	// _generated imports and never reads process.env). scheduleUpgrade wires the
	// module-level scheduler helper to the request-scoped actionCtx.
	const deps: LookupDeps = {
		getCached: (word) =>
			actionCtx.runQuery(internal.words.getAllByWord, { word }),
		saveExact: async (entries, lang) => {
			await actionCtx.runMutation(internal.words.saveMany, { entries, lang });
		},
		getHanjaByChars: (chars) =>
			actionCtx.runQuery(internal.hanja.getByCharacters, { characters: chars }),
		getHanjaByHangul: (syllable) =>
			actionCtx.runQuery(internal.hanja.getByHangul, { hangul: syllable }),
		searchKrdict: (word, lang) => searchWord(krdictApiKey, word, lang),
		lookupHanjaExamples,
		scheduleUpgrade: (resultMsg, result, docs, lang) =>
			scheduleTranslationUpgrade(actionCtx, resultMsg, result, docs, lang),
	};

	bot.command("start", async (ctx) => {
		const userId = ctx.from?.id;
		const settings =
			userId === undefined
				? null
				: await actionCtx.runQuery(internal.userSettings.getByTelegramUserId, {
						telegramUserId: userId,
					});

		if (settings) {
			await ctx.reply(t(settings.lang as Lang).usage);
			return;
		}

		const promptLang = pickPromptLang(ctx.from?.language_code);
		await ctx.reply(t(promptLang).welcomePrompt, {
			reply_markup: buildLangInitKeyboard(),
		});
	});

	bot.command("settings", async (ctx) => {
		const lang = await getUserLang(actionCtx, ctx.from?.id);
		await ctx.reply(t(lang).settingsPrompt, {
			reply_markup: buildSettingsKeyboard(),
		});
	});

	// --- Message handler ---
	bot.on("message:text", async (ctx) => {
		const text = ctx.message.text.trim();
		const chars = [...text];
		const [singleChar] = chars;
		const lang = await getUserLang(actionCtx, ctx.from?.id);

		const ui = t(lang);
		try {
			// Rule 2: single CJK char
			if (chars.length === 1 && singleChar && isHanja(singleChar)) {
				await handleSingleHanja(deps, ctx, singleChar, lang);
				return;
			}
			// Rule 3: multiple CJK chars
			if (chars.length >= 2 && allHanja(text)) {
				await ctx.reply(ui.errors.multipleHanjaWarning);
				return;
			}
			// Rule 4: single Hangul syllable
			if (chars.length === 1 && singleChar && isHangul(singleChar)) {
				await ctx.reply(ui.syllableChoicePrompt(singleChar), {
					parse_mode: "HTML",
					reply_markup: buildSyllableChoiceKeyboard(singleChar, lang),
				});
				return;
			}
			// Rule 5: multi-syllable Hangul (existing flow)
			const match = text.match(/[\uAC00-\uD7AF]{2,}/);
			if (match) {
				await handleWordLookup(
					deps,
					ctx,
					match[0],
					() => ctx.reply(ui.loadingFrames[0]),
					lang,
				);
				return;
			}
			// Rule 6: fallback
			await ctx.reply(ui.usage);
		} catch (err) {
			console.error("Message error:", err);
			await ctx.reply(ui.errors.generic);
		}
	});

	bot.on("callback_query:data", async (ctx) => {
		const data = ctx.callbackQuery.data;
		const lang = await getUserLang(actionCtx, ctx.from?.id);

		try {
			if (data.startsWith("s:")) {
				await runWordLookup(deps, ctx, data.slice(2), lang);
			} else if (data.startsWith("wq:")) {
				await runWordLookup(deps, ctx, data.slice(3), lang);
			} else if (data.startsWith("hh:") || data.startsWith("hp:")) {
				const rest = data.slice(3);
				const idx = rest.lastIndexOf(":");
				const syllable = rest.slice(0, idx);
				const page = Number(rest.slice(idx + 1)) || 0;
				await handleHangulHanjaList(
					deps,
					ctx,
					syllable,
					page,
					/*edit*/ true,
					lang,
				);
			} else if (data.startsWith("m:")) {
				const tc = Number(data.slice(2));
				const doc = await actionCtx.runQuery(internal.words.getByTargetCode, {
					targetCode: tc,
				});
				if (!doc) {
					await ctx.reply(t(lang).errors.staleCache);
				} else {
					const { message, docs } = await formatResultWithHanja(
						deps,
						doc,
						lang,
					);
					const resultMsg = await ctx.reply(message, { parse_mode: "HTML" });
					await scheduleTranslationUpgrade(
						actionCtx,
						resultMsg,
						doc,
						docs,
						lang,
					);
				}
			} else if (data === "lang:en" || data === "lang:ru") {
				const newLang: Lang = data === "lang:en" ? "en" : "ru";
				const userId = ctx.from?.id;
				if (userId !== undefined) {
					await actionCtx.runMutation(internal.userSettings.setLang, {
						telegramUserId: userId,
						lang: newLang,
					});
				}
				await ctx.editMessageText(t(newLang).langConfirm);
			} else if (data === "langinit:en" || data === "langinit:ru") {
				const newLang: Lang = data === "langinit:en" ? "en" : "ru";
				const userId = ctx.from?.id;
				if (userId !== undefined) {
					await actionCtx.runMutation(internal.userSettings.setLang, {
						telegramUserId: userId,
						lang: newLang,
					});
				}
				const ui = t(newLang);
				await ctx.editMessageText(`${ui.langConfirm}\n\n${ui.usage}`);
			}
		} catch (err) {
			console.error("Callback error:", err);
			await ctx.answerCallbackQuery({
				text: t(lang).errors.callback,
				show_alert: true,
			});
			return;
		}

		await ctx.answerCallbackQuery();
	});

	const handleUpdate = webhookCallback(bot, "std/http");
	return await handleUpdate(request);
});
