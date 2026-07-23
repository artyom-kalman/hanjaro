import { describe, expect, test } from "bun:test";
import type { HanjaDoc } from "./hanjaFormat.js";
import {
	anyTranslationNeeded,
	computeTranslationNeeds,
	type TranslationNeeds,
	type WordLike,
} from "./translationNeeds.js";

// Builds a Hanja doc with just the fields hasMissingRuTranslation reads.
function doc(
	character: string,
	meanings: string[],
	ru?: string[],
): NonNullable<HanjaDoc> {
	return {
		character,
		meanings: meanings.map((text) => ({ text })),
		translations: ru ? { ru: ru.map((text) => ({ text })) } : undefined,
	} as NonNullable<HanjaDoc>;
}

// A word with a translation present for `lang`.
function word(
	definition: string,
	translations?: WordLike["translations"],
): WordLike {
	return { definition, translations };
}

const missingRuDoc = doc("水", ["water"]); // meanings, no ru → missing
const translatedRuDoc = doc("火", ["fire"], ["огонь"]); // ru present → not missing
const emptyMeaningsDoc = doc("空", []); // no meanings → never missing

describe("computeTranslationNeeds — missingRuHanja", () => {
	test("en never AI-translates char glosses (Unihan is native)", () => {
		expect(
			computeTranslationNeeds(word(""), [missingRuDoc], "en").missingRuHanja,
		).toEqual([]);
	});

	test("ru with no docs → empty", () => {
		expect(computeTranslationNeeds(word(""), [], "ru").missingRuHanja).toEqual(
			[],
		);
	});

	test("ru with only null docs → empty (nulls filtered out)", () => {
		expect(
			computeTranslationNeeds(word(""), [null], "ru").missingRuHanja,
		).toEqual([]);
	});

	test("ru with a doc missing its ru gloss → included", () => {
		expect(
			computeTranslationNeeds(word(""), [missingRuDoc, null], "ru")
				.missingRuHanja,
		).toEqual([missingRuDoc]);
	});

	test("ru with an already-translated doc → excluded", () => {
		expect(
			computeTranslationNeeds(word(""), [translatedRuDoc], "ru").missingRuHanja,
		).toEqual([]);
	});

	test("ru with an empty-meanings doc → excluded (needs meanings.length > 0)", () => {
		expect(
			computeTranslationNeeds(word(""), [emptyMeaningsDoc], "ru")
				.missingRuHanja,
		).toEqual([]);
	});
});

describe("computeTranslationNeeds — wordNeedsTranslation", () => {
	test("translation present with non-empty transWord → false", () => {
		const w = word("d", { ru: { transWord: "слово", transDfn: "" } });
		expect(computeTranslationNeeds(w, [], "ru").wordNeedsTranslation).toBe(
			false,
		);
	});

	test("translation present with empty transWord → true", () => {
		const w = word("d", { ru: { transWord: "", transDfn: "" } });
		expect(computeTranslationNeeds(w, [], "ru").wordNeedsTranslation).toBe(
			true,
		);
	});

	test("lang key absent (other lang present) → true", () => {
		const w = word("d", { en: { transWord: "word", transDfn: "" } });
		expect(computeTranslationNeeds(w, [], "ru").wordNeedsTranslation).toBe(
			true,
		);
	});

	test("no translations object at all → true", () => {
		expect(
			computeTranslationNeeds(word("d"), [], "ru").wordNeedsTranslation,
		).toBe(true);
	});
});

describe("computeTranslationNeeds — definitionNeeded", () => {
	test("definition present → false", () => {
		expect(computeTranslationNeeds(word("d"), [], "ru").definitionNeeded).toBe(
			false,
		);
	});

	test("definition absent + word translated → true", () => {
		const w = word("", { ru: { transWord: "слово", transDfn: "" } });
		expect(computeTranslationNeeds(w, [], "ru").definitionNeeded).toBe(true);
	});

	test("case 1: definition absent + word untranslated + no transDfn → false", () => {
		// Prompt A will emit a definition anyway, so the standalone def call is skipped.
		expect(computeTranslationNeeds(word(""), [], "ru").definitionNeeded).toBe(
			false,
		);
	});

	test("definition absent + word untranslated + transDfn present → true", () => {
		const w = word("", { ru: { transWord: "", transDfn: "описание" } });
		expect(computeTranslationNeeds(w, [], "ru").definitionNeeded).toBe(true);
	});
});

describe("anyTranslationNeeded", () => {
	const none: TranslationNeeds = {
		missingRuHanja: [],
		wordNeedsTranslation: false,
		definitionNeeded: false,
	};

	test("all-false → false", () => {
		expect(anyTranslationNeeded(none)).toBe(false);
	});

	test("only missing hanja → true", () => {
		expect(
			anyTranslationNeeded({ ...none, missingRuHanja: [missingRuDoc] }),
		).toBe(true);
	});

	test("only word needs translation → true", () => {
		expect(anyTranslationNeeded({ ...none, wordNeedsTranslation: true })).toBe(
			true,
		);
	});

	test("only definition needed → true", () => {
		expect(anyTranslationNeeded({ ...none, definitionNeeded: true })).toBe(
			true,
		);
	});
});
