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

export type WordTranslation = { transWord: string; transDfn: string };

// Builds the word-translation prompt. The target language name is interpolated
// ("English" / "Russian"). For Hanja-origin words the prompt grounds the model
// on each Hanja character and its English meanings; the Hanja block is omitted
// entirely for pure Korean words (empty hanjaContext).
export function buildWordPrompt(input: WordPromptInput, lang: Lang): string {
  const lines: string[] = [
    `Translate a Korean dictionary word into ${LANG_NAME[lang]}.`,
    "Provide (1) a concise gloss (dictionary-style, one word / short phrase),",
    "and (2) a translation of the Korean definition.",
    "Use the Hanja origin and the Korean definition to fix the precise sense.",
    "",
    `Word: ${input.word}`,
  ];
  if (input.pos) lines.push(`Part of speech: ${input.pos}`);

  if (input.hanjaContext.length > 0) {
    lines.push(`Hanja: ${input.hanjaContext.map((h) => h.character).join("")}`);
    for (const h of input.hanjaContext) {
      if (h.englishMeanings.length > 0) {
        lines.push(`  ${h.character} = ${h.englishMeanings.join(", ")}`);
      }
    }
  }

  if (input.definition) lines.push(`Korean definition: ${input.definition}`);

  lines.push("");
  lines.push('Return strict JSON only: {"transWord":"...","transDfn":"..."}');
  return lines.join("\n");
}

// Parses the model's JSON reply into {transWord, transDfn}. Tolerates ```json
// fences (some models wrap output). Returns null on malformed JSON, a non-object
// payload, or an empty `transWord` after trimming — any of which means "no
// usable translation", so the caller leaves the message untouched.
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
  const transDfn = typeof obj.transDfn === "string" ? obj.transDfn.trim() : "";
  if (!transWord) return null;
  return { transWord, transDfn };
}
