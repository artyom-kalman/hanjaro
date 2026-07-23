// Pure, network-free Hanja/Hangul character utilities. Kept free of any Convex
// generated code or grammy imports so they're trivially unit-testable (see
// chars.test.ts). Type-only imports are fine. Centralizes the CJK/Hangul range
// checks and the presentHanja -> { character, englishMeanings } mapping that were
// otherwise duplicated across telegram.ts and translate.ts.
import type { HanjaDoc } from "./hanjaFormat.js";
import type { HanjaContext } from "./wordPrompt.js";

// CJK Unified Ideographs block: U+4E00 .. U+9FFF, both inclusive.
export function isHanja(c: string): boolean {
	return c >= "一" && c <= "鿿";
}

// Hangul Syllables range as used by the bot: U+AC00 .. U+D7AF, both inclusive.
export function isHangul(c: string): boolean {
	return c >= "가" && c <= "힯";
}

export function allHanja(s: string): boolean {
	const chars = [...s];
	return chars.length > 0 && chars.every(isHanja);
}

export function hanjaOnly(origin: string): string[] {
	return [...origin].filter((c) => c >= "一" && c <= "鿿");
}

// Maps present (non-null) Hanja docs to the LLM-prompt context shape. The result
// is compatible with wordPrompt.ts's HanjaContext type.
export function toHanjaContext(docs: NonNullable<HanjaDoc>[]): HanjaContext[] {
	return docs.map((d) => ({
		character: d.character,
		englishMeanings: d.meanings.map((m) => m.text),
	}));
}
