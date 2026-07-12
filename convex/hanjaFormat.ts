import type { Doc } from "./_generated/dataModel.js";
import { escapeHtml, type Lang, t } from "./i18n.js";

export type HanjaDoc = Doc<"hanja"> | null;

// One per-language word translation. `source` distinguishes real KrDict text
// from AI-generated output (absent on legacy rows ⇒ treated as KrDict). It's
// what lets us stamp the AI footer without mislabeling genuine KrDict entries.
export type Translation = {
	transWord: string;
	transDfn: string;
	source?: "krdict" | "ai";
};

export type DisplayResult = {
	word: string;
	origin: string;
	targetCode: number;
	pos: string;
	definition: string;
	translations?: {
		en?: Translation;
		ru?: Translation;
	};
};

export const LANG_FLAG: Record<Lang, string> = { en: "🇬🇧", ru: "🇷🇺" };

// Prefers the user's language; falls back to the other language so a word with
// only one KrDict translation still shows something. Returns the language it
// actually picked so the caller can render the right flag.
export function pickTranslation(
	r: DisplayResult,
	lang: Lang,
): { lang: Lang; translation: Translation } | null {
	const tr = r.translations;
	if (!tr) return null;
	const translation = tr[lang];
	if (translation) return { lang, translation };
	const other: Lang = lang === "en" ? "ru" : "en";
	const otherTranslation = tr[other];
	if (otherTranslation) return { lang: other, translation: otherTranslation };
	return null;
}

// Best short gloss for compact displays (examples, keyboard labels): translated
// word, then translated definition, then the Korean definition.
export function pickResultMeaning(r: DisplayResult, lang: Lang): string {
	const picked = pickTranslation(r, lang);
	return (
		picked?.translation.transWord ||
		picked?.translation.transDfn ||
		r.definition
	);
}

export function pickHanjaMeanings(
	doc: NonNullable<HanjaDoc>,
	lang: Lang,
): { text: string }[] {
	const localized = lang === "ru" ? doc.translations?.ru : undefined;
	return localized && localized.length > 0 ? localized : doc.meanings;
}

export function hasMissingRuTranslation(doc: NonNullable<HanjaDoc>): boolean {
	return doc.meanings.length > 0 && !doc.translations?.ru?.length;
}

// True when at least one rendered gloss came from the AI translation step
// (the `ru` branch of pickHanjaMeanings), so we only stamp the "translated by
// AI" footer on messages that actually contain machine-generated char glosses
// — not on English source glosses or on failed translations that fell back to
// English. English never AI-translates char glosses (Unihan is native).
export function hanjaGlossesAreAi(docs: HanjaDoc[], lang: Lang): boolean {
	return (
		lang === "ru" && docs.some((d) => (d?.translations?.ru?.length ?? 0) > 0)
	);
}

export function formatSearchResult(r: DisplayResult, lang: Lang): string {
	const lines: string[] = [];
	const originPart = r.origin
		? `  ·  <code>${escapeHtml(r.origin)}</code>`
		: "";
	lines.push(`📖  <b>${escapeHtml(r.word)}</b>${originPart}`);
	if (r.pos) {
		const localized = t(lang).posMap[r.pos];
		const posText = localized
			? `${escapeHtml(r.pos)} (${escapeHtml(localized)})`
			: escapeHtml(r.pos);
		lines.push(`<i>${posText}</i>`);
	}

	const picked = pickTranslation(r, lang);
	if (picked?.translation.transWord) {
		lines.push("");
		lines.push(
			`${LANG_FLAG[picked.lang]} ${escapeHtml(picked.translation.transWord)}`,
		);
	}
	const transDfn = picked?.translation.transDfn ?? "";
	if (r.definition || transDfn) lines.push("");
	if (r.definition) lines.push(`<i>${escapeHtml(r.definition)}</i>`);
	if (transDfn) lines.push(`<i>${escapeHtml(transDfn)}</i>`);

	return lines.join("\n");
}

export function formatHanjaBreakdown(
	docs: HanjaDoc[],
	chars: string[],
	lang: Lang,
): string {
	const lines: string[] = [];

	for (let i = 0; i < chars.length; i++) {
		const doc = docs[i];
		const char = chars[i];
		if (!char) continue;
		lines.push("");

		if (!doc || doc.meanings.length === 0) {
			lines.push(
				`<b>${escapeHtml(char)}</b> — ${t(lang).hanjaBreakdownNoData}`,
			);
			continue;
		}

		lines.push(`<b>${escapeHtml(doc.character)}</b>`);
		for (const m of pickHanjaMeanings(doc, lang)) {
			lines.push(` · <i>${escapeHtml(m.text)}</i>`);
		}
		const readings: string[] = [];
		if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
		if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
		if (readings.length > 0) lines.push(readings.join("  "));
	}

	return lines.join("\n");
}

export function formatHanjaExamples(
	examples: DisplayResult[],
	lang: Lang,
): string {
	if (examples.length === 0) return "";

	const lines: string[] = ["", `<b>${t(lang).hanjaExamplesHeader}</b>`];
	for (const example of examples) {
		const meaning = pickResultMeaning(example, lang);
		const originPart = example.origin
			? `  <code>${escapeHtml(example.origin)}</code>`
			: "";
		const meaningPart = meaning ? ` — ${escapeHtml(meaning)}` : "";
		lines.push(
			` · <b>${escapeHtml(example.word)}</b>${originPart}${meaningPart}`,
		);
	}

	return lines.join("\n");
}

// Compact single-character card used for both the immediate reply and its
// optional examples upgrade. Keep its footer handling here so the action
// section always stays above the attribution.
export function formatSingleHanjaCard(
	doc: NonNullable<HanjaDoc>,
	lang: Lang,
	actionLabel?: string,
): string {
	const lines = [`<b>${escapeHtml(doc.character)}</b>`];
	const readings: string[] = [];
	if (doc.hangul) readings.push(escapeHtml(doc.hangul));
	if (doc.mandarin) readings.push(escapeHtml(doc.mandarin));
	if (readings.length > 0) lines.push(readings.join(" · "));

	const meanings = pickHanjaMeanings(doc, lang);
	const meaningText = meanings.map((meaning) => meaning.text).join(" · ");
	lines.push(
		meaningText
			? `<i>${escapeHtml(meaningText)}</i>`
			: t(lang).hanjaBreakdownNoData,
	);

	if (actionLabel) {
		lines.push("", `<b>${escapeHtml(actionLabel)}</b>`);
	}

	return appendHanjaAiFooter(lines.join("\n"), [doc], lang);
}

// Single AI-attribution footer line, language-aware.
function aiFooter(lang: Lang): string {
	return `\n\n${t(lang).aiTranslationNote}`;
}

// The one footer decision: show the AI footer when any rendered Hanja gloss is
// AI (RU only) OR the word translation itself is AI (`source: "ai"`, either
// language). The `source` marker is what keeps genuine KrDict translations from
// being mislabeled as AI.
export function shouldShowAiFooter(
	hanjaDocs: HanjaDoc[],
	result: DisplayResult,
	lang: Lang,
): boolean {
	return (
		hanjaGlossesAreAi(hanjaDocs, lang) ||
		pickTranslation(result, lang)?.translation.source === "ai"
	);
}

// Full word-result message: header + POS + translation + definition, the Hanja
// breakdown (if any), and exactly ONE AI footer. This is the single renderer
// shared by the webhook (initial send) and the background orchestrator (in-place
// upgrade), so the footer decision lives in one place.
export function formatWordResult(
	result: DisplayResult,
	hanjaDocs: HanjaDoc[],
	chars: string[],
	lang: Lang,
): string {
	let body = formatSearchResult(result, lang);
	if (chars.length > 0) {
		body += `\n${formatHanjaBreakdown(hanjaDocs, chars, lang)}`;
	}
	if (shouldShowAiFooter(hanjaDocs, result, lang)) {
		body += aiFooter(lang);
	}
	return body;
}

// Appends the AI footer to a Hanja-only message (single char / hangul page)
// when any rendered char gloss is AI. These flows never carry a word
// translation, so only the Hanja-AI condition applies.
export function appendHanjaAiFooter(
	body: string,
	docs: HanjaDoc[],
	lang: Lang,
): string {
	return hanjaGlossesAreAi(docs, lang) ? body + aiFooter(lang) : body;
}

export function formatHangulHanjaPage(
	syllable: string,
	pageDocs: NonNullable<HanjaDoc>[],
	page: number,
	totalPages: number,
	total: number,
	lang: Lang,
): string {
	const lines: string[] = [];
	lines.push(t(lang).hanjaPageHeader({ syllable, total, page, totalPages }));

	for (const doc of pageDocs) {
		lines.push("");
		const meaningText = pickHanjaMeanings(doc, lang)
			.map((m) => m.text)
			.join(", ");
		const meaningPart = meaningText
			? `  ·  <i>${escapeHtml(meaningText)}</i>`
			: "";
		lines.push(`<b>${escapeHtml(doc.character)}</b>${meaningPart}`);
		const readings: string[] = [];
		if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
		if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
		if (readings.length > 0) lines.push(readings.join("  "));
	}

	return appendHanjaAiFooter(lines.join("\n"), pageDocs, lang);
}
