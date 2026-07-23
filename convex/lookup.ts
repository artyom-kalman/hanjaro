// Lookup flow helpers (word search + Hanja/Hangul breakdowns), extracted from
// the handleTelegramWebhook closure.
// This module never imports Convex generated code (_generated/api or
// _generated/server): all DB/API access is injected as plain async functions
// via the `LookupDeps` object built once in telegram.ts. grammy types
// (Bot["api"]) and the pure hanjaFormat/i18n/chars/krdict modules are the only
// imports, which keeps the lookup flow decoupled from the request-scoped
// actionCtx and unit-testable in isolation.
import type { Bot, Context } from "grammy";
import { hanjaOnly } from "./chars.js";
import {
	type DisplayResult,
	formatHangulHanjaPage,
	formatSingleHanjaCard,
	formatWordResult,
	type HanjaDoc,
} from "./hanjaFormat.js";
import { type Lang, t } from "./i18n.js";
import {
	buildHangulHanjaKeyboard,
	buildHanjaWordKeyboard,
	buildMeaningKeyboard,
	buildSuggestionsKeyboard,
} from "./keyboards.js";
import type { KrdictSearchResult } from "./krdict.js";

const HANGUL_PAGE_SIZE = 8;

export type LoadingMsg = { chat: { id: number }; message_id: number } | null;
export type SentMessage = { chat: { id: number }; message_id: number };

// Injected DB/API access. telegram.ts constructs one of these inside the
// httpAction from actionCtx (runQuery/runMutation against internal.*) plus the
// KrDict API key, so lookup.ts stays free of _generated imports and never reads
// process.env.
export type LookupDeps = {
	getCached(word: string): Promise<DisplayResult[]>;
	saveExact(entries: KrdictSearchResult[], lang: Lang): Promise<void>;
	getHanjaByChars(chars: string[]): Promise<HanjaDoc[]>;
	getHanjaByHangul(syllable: string): Promise<NonNullable<HanjaDoc>[]>;
	searchKrdict(word: string, lang: Lang): Promise<KrdictSearchResult[]>;
	lookupHanjaExamples(character: string, lang: Lang): Promise<DisplayResult[]>;
	// Schedules the background AI-translation upgrade once a single exact result
	// is shown. Injected from telegram.ts because the decision + scheduling touch
	// Convex internals (translationNeeds + scheduler.runAfter), which this module
	// stays free of; here it's just a fire-and-forget callback.
	scheduleUpgrade(
		resultMsg: SentMessage,
		result: DisplayResult,
		docs: HanjaDoc[],
		lang: Lang,
	): Promise<void>;
};

export function findExactMatches<T extends { word: string }>(
	results: T[],
	query: string,
): { exact: T[]; suggestions: T[] } {
	const exact = results.filter((r) => r.word === query);
	const suggestions = exact.length === 0 ? results.slice(0, 5) : [];
	return { exact, suggestions };
}

export function startSpinner(
	api: Bot["api"],
	chatId: number,
	messageId: number,
	frames: readonly string[],
): { stop: () => void } {
	if (frames.length === 0) return { stop: () => {} };

	let i = 0;
	const spinInterval = setInterval(() => {
		i = (i + 1) % frames.length;
		const frame = frames[i];
		if (frame) api.editMessageText(chatId, messageId, frame).catch(() => {});
	}, 700);
	api.sendChatAction(chatId, "typing").catch(() => {});
	const typingInterval = setInterval(() => {
		api.sendChatAction(chatId, "typing").catch(() => {});
	}, 3000);
	return {
		stop: () => {
			clearInterval(spinInterval);
			clearInterval(typingInterval);
		},
	};
}

export async function sendOrEdit(
	ctx: {
		reply: (text: string, opts?: object) => Promise<SentMessage>;
		api: Bot["api"];
	},
	loadingMsg: LoadingMsg,
	text: string,
	opts?: Record<string, unknown>,
): Promise<SentMessage> {
	if (loadingMsg) {
		await ctx.api.editMessageText(
			loadingMsg.chat.id,
			loadingMsg.message_id,
			text,
			opts,
		);
		return loadingMsg;
	}
	return ctx.reply(text, opts);
}

export function krdictToDisplay(
	r: KrdictSearchResult,
	lang: Lang,
): DisplayResult {
	return {
		word: r.word,
		origin: r.origin,
		targetCode: r.targetCode,
		pos: r.pos,
		definition: r.definition,
		translations: {
			[lang]: { transWord: r.transWord, transDfn: r.transDfn },
		},
	};
}

export function cachedHasLang(docs: DisplayResult[], lang: Lang): boolean {
	return docs.some((d) => d.translations?.[lang] !== undefined);
}

export async function searchFromApi(
	deps: LookupDeps,
	word: string,
	lang: Lang,
): Promise<DisplayResult[]> {
	const results = await deps.searchKrdict(word, lang);
	const { exact } = findExactMatches(results, word);
	if (exact.length > 0) {
		await deps.saveExact(exact, lang);
	}
	return results.map((r) => krdictToDisplay(r, lang));
}

export async function resolveWord(
	deps: LookupDeps,
	word: string,
	sendLoading: () => Promise<NonNullable<LoadingMsg>>,
	api: Bot["api"],
	lang: Lang,
): Promise<{ results: DisplayResult[]; loadingMsg: LoadingMsg }> {
	const cached = await deps.getCached(word);
	if (cached.length > 0 && cachedHasLang(cached, lang)) {
		return { results: cached, loadingMsg: null };
	}

	const loadingMsg = await sendLoading();
	const spinner = startSpinner(
		api,
		loadingMsg.chat.id,
		loadingMsg.message_id,
		t(lang).loadingFrames,
	);
	try {
		const apiResults = await searchFromApi(deps, word, lang);
		// Prefer refreshed cache (merged translations) for exact matches
		const refreshed = await deps.getCached(word);
		const { exact: refreshedExact } = findExactMatches(refreshed, word);
		if (refreshedExact.length > 0) {
			return { results: refreshed, loadingMsg };
		}
		return { results: apiResults, loadingMsg };
	} finally {
		spinner.stop();
	}
}

export async function formatResultWithHanja(
	deps: LookupDeps,
	result: DisplayResult,
	lang: Lang,
): Promise<{ message: string; docs: HanjaDoc[]; chars: string[] }> {
	const chars = result.origin ? hanjaOnly(result.origin) : [];
	let docs: HanjaDoc[] = [];
	if (chars.length > 0) {
		docs = await deps.getHanjaByChars(chars);
	}
	const message = formatWordResult(result, docs, chars, lang);
	return { message, docs, chars };
}

// Full word-lookup flow: resolve the word (cache or KrDict), then reply/edit
// with the no-results / suggestions / single-result / multiple-meanings branch.
// On a single exact match it fires the AI-upgrade schedule via deps.
export async function handleWordLookup(
	deps: LookupDeps,
	ctx: Context,
	word: string,
	sendLoading: () => Promise<NonNullable<LoadingMsg>>,
	lang: Lang,
): Promise<void> {
	const { results, loadingMsg } = await resolveWord(
		deps,
		word,
		sendLoading,
		ctx.api,
		lang,
	);

	const ui = t(lang);

	if (results.length === 0) {
		await sendOrEdit(ctx, loadingMsg, ui.errors.noResults(word), {
			parse_mode: "HTML",
		});
		return;
	}

	const { exact, suggestions } = findExactMatches(results, word);

	if (exact.length === 0) {
		const keyboard = buildSuggestionsKeyboard(suggestions.map((s) => s.word));
		await sendOrEdit(ctx, loadingMsg, ui.errors.noExactMatch(word), {
			parse_mode: "HTML",
			reply_markup: keyboard,
		});
		return;
	}

	if (exact.length === 1) {
		const exactMatch = exact[0];
		if (!exactMatch) return;
		const { message, docs } = await formatResultWithHanja(
			deps,
			exactMatch,
			lang,
		);
		const resultMsg = await sendOrEdit(ctx, loadingMsg, message, {
			parse_mode: "HTML",
		});
		await deps.scheduleUpgrade(resultMsg, exactMatch, docs, lang);
		return;
	}

	await sendOrEdit(ctx, loadingMsg, ui.errors.multipleMeanings(word), {
		parse_mode: "HTML",
		reply_markup: buildMeaningKeyboard(exact, lang),
	});
}

// Callback-triggered lookup: shows a fresh "typing" + loading message first,
// then delegates to handleWordLookup.
export async function runWordLookup(
	deps: LookupDeps,
	ctx: Context,
	word: string,
	lang: Lang,
): Promise<void> {
	await handleWordLookup(
		deps,
		ctx,
		word,
		async () => {
			await ctx.replyWithChatAction("typing");
			return ctx.reply(t(lang).loadingFrames[0]);
		},
		lang,
	);
}

// Single-Hanja card reply, then optional upgrade with example-word actions.
export async function handleSingleHanja(
	deps: LookupDeps,
	ctx: Context,
	char: string,
	lang: Lang,
): Promise<void> {
	const docs = await deps.getHanjaByChars([char]);
	const doc = docs[0];

	if (!doc) {
		await ctx.reply(t(lang).errors.noHanjaEntry(char), {
			parse_mode: "HTML",
		});
		return;
	}

	const initialText = formatSingleHanjaCard(doc, lang);
	const resultMsg = await ctx.reply(initialText, { parse_mode: "HTML" });

	const examples = await deps.lookupHanjaExamples(char, lang);
	if (examples.length === 0) {
		return;
	}

	const upgradedText = formatSingleHanjaCard(
		doc,
		lang,
		t(lang).hanjaWordActionsHeader,
	);

	try {
		await ctx.api.editMessageText(
			resultMsg.chat.id,
			resultMsg.message_id,
			upgradedText,
			{
				parse_mode: "HTML",
				reply_markup: buildHanjaWordKeyboard(examples, lang),
			},
		);
	} catch (error) {
		console.error("Sigle-Hanja examples upgrade failed", error);
	}
}

// Paged list of Hanja that share a given Hangul syllable. `edit` chooses
// between editing the current message (paging callbacks) and a fresh reply.
export async function handleHangulHanjaList(
	deps: LookupDeps,
	ctx: Context,
	syllable: string,
	page: number,
	edit: boolean,
	lang: Lang,
): Promise<void> {
	const docs = await deps.getHanjaByHangul(syllable);
	if (docs.length === 0) {
		const text = t(lang).errors.noHanjaForSyllable(syllable);
		if (edit) await ctx.editMessageText(text, { parse_mode: "HTML" });
		else await ctx.reply(text, { parse_mode: "HTML" });
		return;
	}
	const totalPages = Math.ceil(docs.length / HANGUL_PAGE_SIZE);
	const safePage = Math.max(0, Math.min(page, totalPages - 1));
	const start = safePage * HANGUL_PAGE_SIZE;
	const pageDocs = docs.slice(start, start + HANGUL_PAGE_SIZE);
	const text = formatHangulHanjaPage(
		syllable,
		pageDocs,
		safePage,
		totalPages,
		docs.length,
		lang,
	);
	const keyboard = buildHangulHanjaKeyboard(
		syllable,
		safePage,
		totalPages,
		lang,
	);
	const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };
	if (edit) await ctx.editMessageText(text, opts);
	else await ctx.reply(text, opts);
}
