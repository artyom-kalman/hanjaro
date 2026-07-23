import { v } from "convex/values";
import { Bot } from "grammy";
import OpenAI from "openai";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalAction } from "./_generated/server.js";
import { hanjaOnly, toHanjaContext } from "./chars.js";
import { type DisplayResult, formatWordResult } from "./hanjaFormat.js";
import { t } from "./i18n.js";
import {
	anyTranslationNeeded,
	computeTranslationNeeds,
} from "./translationNeeds.js";
import {
	buildCharGlossPrompt,
	buildDefinitionPrompt,
	buildGlossFromDescriptionPrompt,
	buildWordPrompt,
	type CharInput as CharGlossInput,
	type ExampleWord,
	parseCharGlossResponse,
	parseDefinitionResponse,
	parseWordResponse,
} from "./wordPrompt.js";

// OpenRouter is OpenAI-API-compatible — pointing baseURL at it lets us reuse
// the openai SDK without adding a dep. Default model is Google Gemini 3.1
// Flash Lite (paid, ~$0.25/$1.50 per 1M tok, ~0.84s latency, JSON mode
// supported). Override via OPENROUTER_MODEL when experimenting.
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
// Per-attempt request timeout. The OpenAI SDK throws APIConnectionTimeoutError
// when this elapses, which (unlike a manual AbortController signal) is retried
// automatically. With MAX_RETRIES, worst-case latency before we give up is
// roughly (MAX_RETRIES + 1) * TIMEOUT_MS plus exponential backoff. Safe here
// because this runs as a detached scheduled action with no webhook deadline.
const TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;

// Carries the Convex Hanja id alongside the prompt-side char fields, which live
// in wordPrompt.ts (kept Convex-free). buildCharGlossPrompt only reads the shared
// fields; the id is used when saving translations back.
type CharInput = CharGlossInput & { id: Id<"hanja"> };

const EXAMPLES_PER_CHAR = 3;

// Single OpenRouter JSON-mode chat completion. Centralizes client setup, the
// timeout/retry config, and content extraction (some OpenRouter-hosted models
// route the answer into `reasoning` instead of `content`). Returns the raw
// response string, or null when the key is missing, the call fails, or the
// model returned nothing usable. Callers parse the JSON themselves.
async function callOpenRouterJson(prompt: string): Promise<string | null> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error("translate: OPENROUTER_API_KEY not set");
		return null;
	}
	const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
	const client = new OpenAI({
		apiKey,
		baseURL: "https://openrouter.ai/api/v1",
	});
	try {
		const completion = await client.chat.completions.create(
			{
				model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.2,
				response_format: { type: "json_object" },
			},
			{ timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES },
		);
		const choices = completion?.choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			console.error(
				"translate: unexpected response shape",
				JSON.stringify(completion),
			);
			return null;
		}
		const message = choices[0]?.message as
			| {
					content?: string | null;
					reasoning?: string | null;
					reasoning_content?: string | null;
			  }
			| undefined;
		// Some OpenRouter-hosted models occasionally route the answer into
		// `reasoning` instead of `content`. Try the standard field first, then
		// known alternates. Empty string from any of them is treated as "no answer".
		const raw =
			message?.content?.trim() ||
			message?.reasoning?.trim() ||
			message?.reasoning_content?.trim() ||
			"";
		if (!raw) {
			console.error(
				"translate: empty content; full message =",
				JSON.stringify(message),
			);
			return null;
		}
		return raw;
	} catch (err) {
		console.error("translate: OpenRouter call failed", err);
		return null;
	}
}

export const translateHanjaToRu = internalAction({
	args: {
		docs: v.array(
			v.object({
				id: v.id("hanja"),
				character: v.string(),
				hangul: v.optional(v.string()),
				mandarin: v.optional(v.string()),
				englishMeanings: v.array(v.string()),
			}),
		),
	},
	handler: async (ctx, { docs }): Promise<{ translatedCount: number }> => {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			console.error("translate: OPENROUTER_API_KEY not set");
			return { translatedCount: 0 };
		}
		const targets: CharInput[] = docs.filter(
			(d) => d.englishMeanings.length > 0,
		);
		if (targets.length === 0) return { translatedCount: 0 };

		const examplesList = await ctx.runQuery(
			internal.words.getExamplesForCharacters,
			{
				characters: targets.map((t) => t.character),
				lang: "ru",
				limit: EXAMPLES_PER_CHAR,
			},
		);
		const examplesByChar = new Map<string, ExampleWord[]>();
		for (const e of examplesList) {
			examplesByChar.set(e.character, e.examples);
		}

		const raw = await callOpenRouterJson(
			buildCharGlossPrompt(targets, examplesByChar),
		);
		if (!raw) return { translatedCount: 0 };

		const parsed = parseCharGlossResponse(raw, targets);
		if (!parsed) {
			console.error("translate: malformed JSON from model", raw);
			return { translatedCount: 0 };
		}

		const entries = targets
			.map((d) => {
				const glosses = parsed.get(d.character);
				if (!glosses) return null;
				return { id: d.id, meanings: glosses.map((text) => ({ text })) };
			})
			.filter((e): e is NonNullable<typeof e> => e !== null);

		if (entries.length === 0) return { translatedCount: 0 };

		await ctx.runMutation(internal.hanja.saveTranslations, {
			lang: "ru",
			entries,
		});

		return { translatedCount: entries.length };
	},
});

// Word-level AI translation for a single language (en or ru). Branches on
// whether KrDict left a description (Korean definition and/or transDfn):
// case 1 → Prompt A (word + Hanja, gloss + transDfn + Korean definition);
// case 2 → Prompt B (description-grounded gloss only, transDfn pass-through).
// Degrades gracefully: any failure / unusable reply returns { translated: false }.
export const translateWordToLang = internalAction({
	args: {
		targetCode: v.number(),
		lang: v.union(v.literal("en"), v.literal("ru")),
		word: v.string(),
		origin: v.string(),
		pos: v.string(),
		definition: v.string(),
		transDfn: v.string(),
		hanjaContext: v.array(
			v.object({
				character: v.string(),
				englishMeanings: v.array(v.string()),
			}),
		),
	},
	handler: async (ctx, args): Promise<{ translated: boolean }> => {
		const hasDescription = args.definition !== "" || args.transDfn !== "";
		const hanjaContext = args.hanjaContext;

		const prompt = hasDescription
			? buildGlossFromDescriptionPrompt(
					{
						word: args.word,
						pos: args.pos,
						hanjaContext,
						description: args.definition || args.transDfn,
					},
					args.lang,
				)
			: buildWordPrompt(
					{
						word: args.word,
						pos: args.pos,
						definition: "",
						hanjaContext,
					},
					args.lang,
				);

		const raw = await callOpenRouterJson(prompt);
		if (!raw) return { translated: false };

		const parsed = parseWordResponse(raw);
		if (!parsed) {
			console.error("translateWordToLang: unusable response", raw);
			return { translated: false };
		}

		const saveArgs: {
			targetCode: number;
			lang: "en" | "ru";
			transWord: string;
			transDfn: string;
			definition?: string;
		} = {
			targetCode: args.targetCode,
			lang: args.lang,
			transWord: parsed.transWord,
			transDfn: hasDescription ? args.transDfn : parsed.transDfn,
		};

		if (!hasDescription && args.definition === "" && parsed.definition) {
			saveArgs.definition = parsed.definition;
		}

		await ctx.runMutation(internal.words.saveAiWordTranslation, saveArgs);

		return { translated: true };
	},
});

// Generates a Korean definition (Prompt C) for a word that already has a gloss
// but no Korean definition — the missed case where KrDict supplied a gloss but no
// 뜻풀이. Saves the definition only, never touching translations, so a real KrDict
// gloss is not relabeled as AI. Degrades gracefully.
export const translateWordDefinition = internalAction({
	args: {
		targetCode: v.number(),
		lang: v.union(v.literal("en"), v.literal("ru")),
		word: v.string(),
		pos: v.string(),
		meaning: v.string(),
		hanjaContext: v.array(
			v.object({
				character: v.string(),
				englishMeanings: v.array(v.string()),
			}),
		),
	},
	handler: async (ctx, args): Promise<{ translated: boolean }> => {
		const prompt = buildDefinitionPrompt(
			{
				word: args.word,
				pos: args.pos,
				hanjaContext: args.hanjaContext,
				meaning: args.meaning,
			},
			args.lang,
		);

		const raw = await callOpenRouterJson(prompt);
		if (!raw) return { translated: false };

		const parsed = parseDefinitionResponse(raw);
		if (!parsed) {
			console.error("translateWordDefinition: unusable response", raw);
			return { translated: false };
		}

		await ctx.runMutation(internal.words.saveAiDefinition, {
			targetCode: args.targetCode,
			definition: parsed.definition,
		});

		return { translated: true };
	},
});

// Background orchestrator dispatched by the webhook handler. Keyed only by
// targetCode + lang, it re-derives everything (the word, its Hanja chars, the
// Hanja docs), runs the needed independent LLM calls CONCURRENTLY — char-gloss
// translation (RU only) and word-level translation (en or ru) — then re-renders
// the full message and performs exactly ONE editMessageText. Re-deriving here
// (rather than freezing a rendered prefix at schedule time) is what lets a newly
// added word-translation line appear, and the single edit is what keeps the two
// LLM calls from racing on the same message. Runs detached, so it can outlast
// grammy's 10s webhook deadline.
export const scheduledTranslateAndEdit = internalAction({
	args: {
		chatId: v.number(),
		messageId: v.number(),
		targetCode: v.number(),
		lang: v.union(v.literal("en"), v.literal("ru")),
	},
	handler: async (ctx, { chatId, messageId, targetCode, lang }) => {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) {
			console.error("scheduledTranslateAndEdit: TELEGRAM_BOT_TOKEN not set");
			return;
		}

		const word = await ctx.runQuery(internal.words.getByTargetCode, {
			targetCode,
		});
		if (!word) {
			console.error("scheduledTranslateAndEdit: word not found", targetCode);
			return;
		}

		const chars = hanjaOnly(word.origin);
		const hanjaDocs =
			chars.length > 0
				? await ctx.runQuery(internal.hanja.getByCharacters, {
						characters: chars,
					})
				: [];
		const presentHanja = hanjaDocs.filter(
			(d): d is NonNullable<typeof d> => d !== null,
		);
		const hanjaContext = toHanjaContext(presentHanja);

		// The shared schedule/translate decision (translationNeeds.ts) — the same
		// rules the webhook uses to decide whether to schedule this action at all.
		const needs = computeTranslationNeeds(word, hanjaDocs, lang);
		const attempted = anyTranslationNeeded(needs);
		// Still needed as call args (not for the decision): the transDfn passed to
		// translateWordToLang and the defPromise meaning fallback.
		const existingTransDfn = word.translations[lang]?.transDfn ?? "";

		const charPromise =
			needs.missingRuHanja.length > 0
				? ctx.runAction(internal.translate.translateHanjaToRu, {
						docs: needs.missingRuHanja.map((d) => ({
							id: d._id,
							character: d.character,
							hangul: d.hangul,
							mandarin: d.mandarin,
							englishMeanings: d.meanings.map((m) => m.text),
						})),
					})
				: Promise.resolve({ translatedCount: 0 });
		const wordPromise = needs.wordNeedsTranslation
			? ctx.runAction(internal.translate.translateWordToLang, {
					targetCode,
					lang,
					word: word.word,
					origin: word.origin,
					pos: word.pos,
					definition: word.definition,
					transDfn: existingTransDfn,
					hanjaContext,
				})
			: Promise.resolve({ translated: false });
		const defPromise = needs.definitionNeeded
			? ctx.runAction(internal.translate.translateWordDefinition, {
					targetCode,
					lang,
					word: word.word,
					pos: word.pos,
					meaning: word.translations[lang]?.transWord || existingTransDfn,
					hanjaContext,
				})
			: Promise.resolve({ translated: false });

		let charResult = { translatedCount: 0 };
		let wordResult = { translated: false };
		let defResult = { translated: false };
		const [charOutcome, wordOutcome, defOutcome] = await Promise.allSettled([
			charPromise,
			wordPromise,
			defPromise,
		]);
		if (charOutcome.status === "fulfilled") {
			charResult = charOutcome.value;
		} else {
			console.error(
				"scheduledTranslateAndEdit: translation failed",
				charOutcome.reason,
			);
		}
		if (wordOutcome.status === "fulfilled") {
			wordResult = wordOutcome.value;
		} else {
			console.error(
				"scheduledTranslateAndEdit: translation failed",
				wordOutcome.reason,
			);
		}
		if (defOutcome.status === "fulfilled") {
			defResult = defOutcome.value;
		} else {
			console.error(
				"scheduledTranslateAndEdit: translation failed",
				defOutcome.reason,
			);
		}
		const producedSomething =
			charResult.translatedCount > 0 ||
			wordResult.translated ||
			defResult.translated;

		// Re-query so the re-render reflects whatever made it into the cache.
		const finalWord =
			(await ctx.runQuery(internal.words.getByTargetCode, { targetCode })) ??
			word;
		const refreshedHanja =
			chars.length > 0
				? await ctx.runQuery(internal.hanja.getByCharacters, {
						characters: chars,
					})
				: [];
		const display: DisplayResult = {
			word: finalWord.word,
			origin: finalWord.origin,
			targetCode: finalWord.targetCode,
			pos: finalWord.pos,
			definition: finalWord.definition,
			translations: finalWord.translations,
		};

		let body = formatWordResult(display, refreshedHanja, chars, lang);
		if (attempted && !producedSomething) {
			body += `\n\n${t(lang).aiTranslateFailed}`;
		}

		const bot = new Bot(token);
		try {
			await bot.api.editMessageText(chatId, messageId, body, {
				parse_mode: "HTML",
			});
		} catch (err) {
			// Includes Telegram's "message is not modified" when nothing changed.
			console.error("scheduledTranslateAndEdit: editMessageText failed", err);
		}
	},
});
