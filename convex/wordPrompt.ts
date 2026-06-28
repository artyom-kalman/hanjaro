// Pure, network-free helpers for the word-level AI translation call. Kept free
// of any Convex / OpenAI imports so they're trivially unit-testable (see
// wordPrompt.test.ts). The action that drives the LLM lives in translate.ts.
import type { Lang } from "./i18n.js";

const LANG_NAME: Record<Lang, string> = { en: "English", ru: "Russian" };

export type HanjaContext = { character: string; englishMeanings: string[] };

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

// Parses a Korean-definition-only reply into {definition}. Tolerates ```json
// fences. Returns null on malformed JSON or an empty `definition` after trimming.
export function parseDefinitionResponse(raw: string): { definition: string } | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const definition =
    typeof obj.definition === "string" ? obj.definition.trim() : "";
  if (!definition) return null;
  return { definition };
}

// Parses the model's JSON reply into {transWord, transDfn, definition?}.
// Tolerates ```json fences (some models wrap output). Returns null on malformed
// JSON, a non-object payload, or an empty `transWord` after trimming — any of
// which means "no usable translation", so the caller leaves the message
// untouched.
export function parseWordResponse(raw: string): WordTranslation | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const transWord =
    typeof obj.transWord === "string" ? obj.transWord.trim() : "";
  const transDfn =
    typeof obj.transDfn === "string" ? obj.transDfn.trim() : "";
  if (!transWord) return null;

  const result: WordTranslation = { transWord, transDfn };
  if (typeof obj.definition === "string" && obj.definition.trim()) {
    result.definition = obj.definition.trim();
  }
  return result;
}
