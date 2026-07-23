// Pure, network-free prompt building + response parsing for every AI call the
// bot makes: word-level translation (Prompts A/B/C) and Hanja char-gloss
// translation. The single home for prompt strings and JSON parsing. Kept free of
// any Convex / OpenAI imports so it's trivially unit-testable (see
// wordPrompt.test.ts). The actions that drive the LLM live in translate.ts.
import { z } from "zod";
import type { Lang } from "./i18n.js";
import { parseLlmJson } from "./llmJson.js";

const LANG_NAME: Record<Lang, string> = { en: "English", ru: "Russian" };

export type HanjaContext = { character: string; englishMeanings: string[] };

// Prompt-side Hanja char input: everything buildCharGlossPrompt needs to render
// one line, WITHOUT the Convex `Id<"hanja">` the caller carries — translate.ts
// intersects this with its own `{ id }` so this module stays Convex-free.
export type CharInput = {
	character: string;
	hangul?: string;
	mandarin?: string;
	englishMeanings: string[];
};

export type ExampleWord = { word: string; transWord: string };

export type WordPromptInput = {
	word: string;
	pos: string;
	definition: string;
	hanjaContext: HanjaContext[];
};

export type GlossFromDescriptionInput = {
	word: string;
	pos: string;
	hanjaContext: HanjaContext[];
	description: string;
};

export type DefinitionPromptInput = {
	word: string;
	pos: string;
	hanjaContext: HanjaContext[];
	meaning: string;
};

export type WordTranslation = {
	transWord: string;
	transDfn: string;
	definition?: string;
};

function appendHanjaBlock(lines: string[], hanjaContext: HanjaContext[]): void {
	if (hanjaContext.length === 0) return;
	lines.push(`Hanja: ${hanjaContext.map((h) => h.character).join("")}`);
	for (const h of hanjaContext) {
		if (h.englishMeanings.length > 0) {
			lines.push(`  ${h.character} = ${h.englishMeanings.join(", ")}`);
		}
	}
}

// Builds the word-translation prompt (Prompt A). The target language name is
// interpolated ("English" / "Russian"). For Hanja-origin words the prompt
// grounds the model on each Hanja character and its English meanings; the Hanja
// block is omitted entirely for pure Korean words (empty hanjaContext).
export function buildWordPrompt(input: WordPromptInput, lang: Lang): string {
	const langName = LANG_NAME[lang];
	const lines: string[] = [
		`Translate a Korean dictionary word into ${langName}.`,
		"Provide (1) a concise gloss (dictionary-style, one word / short phrase),",
		`(2) a translation of the meaning into ${langName}, and`,
		"(3) a short Korean-language definition (한국어 뜻풀이) of the word.",
		"Use the Hanja origin to fix the precise sense.",
		"",
		`Word: ${input.word}`,
	];
	if (input.pos) lines.push(`Part of speech: ${input.pos}`);

	appendHanjaBlock(lines, input.hanjaContext);

	if (input.definition) lines.push(`Korean definition: ${input.definition}`);

	lines.push("");
	lines.push(
		`Return strict JSON only: {"definition":"<Korean text only>","transWord":"<${langName} gloss>","transDfn":"<${langName} meaning translation>"}`,
	);
	return lines.join("\n");
}

// Builds a gloss-only prompt (Prompt B) grounded on an existing description.
// The Hanja block is included when hanjaContext is non-empty.
export function buildGlossFromDescriptionPrompt(
	input: GlossFromDescriptionInput,
	lang: Lang,
): string {
	const langName = LANG_NAME[lang];
	const lines: string[] = [
		`Give a concise dictionary gloss for a Korean word in ${langName}.`,
		"Use the definition below to pick the exact sense.",
		"Output ONE word or a short phrase — the gloss only, not a sentence.",
		"",
		`Word: ${input.word}`,
	];
	if (input.pos) lines.push(`Part of speech: ${input.pos}`);

	appendHanjaBlock(lines, input.hanjaContext);

	lines.push(`Definition: ${input.description}`);
	lines.push("");
	lines.push('Return strict JSON only: {"transWord":"..."}');
	return lines.join("\n");
}

// Builds a Korean-definition-only prompt (Prompt C) for words that already have a
// gloss but no Korean definition. Grounded on the word, its Hanja, and whatever
// target-language meaning already exists.
export function buildDefinitionPrompt(
	input: DefinitionPromptInput,
	lang: Lang,
): string {
	const lines: string[] = [
		"Write a short Korean-language definition (한국어 뜻풀이) for a Korean word.",
		"One concise sentence, in Korean, dictionary-style.",
		"",
		`Word: ${input.word}`,
	];
	if (input.pos) lines.push(`Part of speech: ${input.pos}`);

	appendHanjaBlock(lines, input.hanjaContext);

	if (input.meaning) {
		lines.push(`Meaning (${LANG_NAME[lang]}): ${input.meaning}`);
	}
	lines.push("");
	lines.push('Return strict JSON only: {"definition":"<Korean text only>"}');
	return lines.join("\n");
}

// A Korean-definition-only reply: {definition}. The definition is trimmed and
// must be non-empty; anything else (missing / non-string / blank) fails the
// refine, so parseLlmJson returns null.
const definitionSchema = z
	.object({ definition: z.string() })
	.transform((o) => ({ definition: o.definition.trim() }))
	.refine((o) => o.definition.length > 0);

// The word-translation reply: {transWord, transDfn, definition?}. transWord is
// trimmed and must be non-empty (empty ⇒ refine fails ⇒ null). transDfn and
// definition are read leniently — a wrong-typed value coerces to "" rather than
// rejecting, matching the legacy behavior — with transDfn defaulting to "" and
// the optional definition included only when non-empty after trimming.
const wordTranslationSchema = z
	.object({
		transWord: z.string(),
		transDfn: z.unknown().optional(),
		definition: z.unknown().optional(),
	})
	.transform((o) => {
		const result: WordTranslation = {
			transWord: o.transWord.trim(),
			transDfn: typeof o.transDfn === "string" ? o.transDfn.trim() : "",
		};
		const definition =
			typeof o.definition === "string" ? o.definition.trim() : "";
		if (definition) result.definition = definition;
		return result;
	})
	.refine((o) => o.transWord.length > 0);

// Parses a Korean-definition-only reply into {definition}. Tolerates ```json
// fences (handled by parseLlmJson). Returns null on malformed JSON or an empty
// `definition` after trimming.
export function parseDefinitionResponse(
	raw: string,
): { definition: string } | null {
	return parseLlmJson(raw, definitionSchema);
}

// Parses the model's JSON reply into {transWord, transDfn, definition?}.
// Tolerates ```json fences (handled by parseLlmJson). Returns null on malformed
// JSON, a non-object payload, or an empty `transWord` after trimming — any of
// which means "no usable translation", so the caller leaves the message
// untouched.
export function parseWordResponse(raw: string): WordTranslation | null {
	return parseLlmJson(raw, wordTranslationSchema);
}

// Builds the Hanja char-gloss translation prompt: each character's English
// meanings, optional Korean/Pinyin context, and example words are laid out so
// the model returns Russian glosses keyed by character. Output must stay
// byte-identical to the legacy translate.ts builder.
export function buildCharGlossPrompt(
	chars: CharInput[],
	examplesByChar: Map<string, ExampleWord[]>,
): string {
	const lines: string[] = [
		"Translate Korean Hanja (Chinese character) glosses from English to Russian.",
		"For each character, translate each English meaning into a single concise Russian word",
		"or short phrase, dictionary-style. Keep the same number of glosses per character.",
		"When example words are provided, use them to ground the meaning — the Russian gloss",
		"should be consistent with how the character is used in those words.",
		"",
		"Characters:",
	];
	for (const c of chars) {
		const ctx: string[] = [];
		if (c.hangul) ctx.push(`Korean: ${c.hangul}`);
		if (c.mandarin) ctx.push(`Pinyin: ${c.mandarin}`);
		const ctxPart = ctx.length > 0 ? ` (${ctx.join(", ")})` : "";
		lines.push(`- ${c.character}${ctxPart}: ${c.englishMeanings.join(", ")}`);
		const examples = examplesByChar.get(c.character) ?? [];
		if (examples.length > 0) {
			const exStr = examples
				.map((e) => `${e.word} = ${e.transWord}`)
				.join(", ");
			lines.push(`  Example words: ${exStr}`);
		}
	}
	lines.push("");
	lines.push(
		"Return strict JSON only, no preamble. Keys are the characters above,",
	);
	lines.push("values are arrays of Russian glosses. Example shape:");
	lines.push('{"正":["правильный","надлежащий","верный"]}');
	return lines.join("\n");
}

// The char-gloss reply is a JSON object keyed by character; each value SHOULD be
// an array of Russian glosses but the schema only asserts "object" — non-array
// values are tolerated and skipped below, matching legacy semantics. Malformed
// JSON or a non-object payload makes parseLlmJson return null.
const charGlossSchema = z.record(z.string(), z.unknown());

// Parses the char-gloss reply into a Map of character -> glosses. For each input
// char: skip when its value isn't an array; keep only string glosses, trimmed,
// dropping empties; set the char only when ≥1 gloss remains. Returns null on
// malformed JSON / non-object payload (the caller logs + emits zero count).
export function parseCharGlossResponse(
	raw: string,
	chars: CharInput[],
): Map<string, string[]> | null {
	const parsed = parseLlmJson(raw, charGlossSchema);
	if (!parsed) return null;
	const result = new Map<string, string[]>();
	for (const c of chars) {
		const value = parsed[c.character];
		if (!Array.isArray(value)) continue;
		const glosses = value
			.filter((g): g is string => typeof g === "string")
			.map((g) => g.trim())
			.filter((g) => g.length > 0);
		if (glosses.length > 0) result.set(c.character, glosses);
	}
	return result;
}
