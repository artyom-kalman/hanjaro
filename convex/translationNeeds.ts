// Pure, network-free decision for which AI translation calls a word needs.
// Shared by the webhook (schedule-or-not) and the orchestrator (which calls
// to run), so the two can never diverge again.

import type { DisplayResult, HanjaDoc } from "./hanjaFormat.js";
import { hasMissingRuTranslation } from "./hanjaFormat.js";
import type { Lang } from "./i18n.js";

// The plain-data slice of a word this decision reads. Anything shaped like a
// DisplayResult (or a `words` doc) satisfies it.
export type WordLike = {
	definition: string;
	// Optional to mirror DisplayResult exactly; the body reads it defensively.
	translations?: DisplayResult["translations"];
};

export type TranslationNeeds = {
	missingRuHanja: NonNullable<HanjaDoc>[]; // RU only; EN glosses are native Unihan
	wordNeedsTranslation: boolean;
	definitionNeeded: boolean; // false when Prompt A (case 1) will emit one anyway
};

export function computeTranslationNeeds(
	word: WordLike,
	hanjaDocs: HanjaDoc[],
	lang: Lang,
): TranslationNeeds {
	const presentHanja = hanjaDocs.filter(
		(d): d is NonNullable<HanjaDoc> => d !== null,
	);
	// Char glosses only ever AI-translate for Russian (English is native Unihan).
	const missingRuHanja =
		lang === "ru" ? presentHanja.filter(hasMissingRuTranslation) : [];

	const wordNeedsTranslation = !word.translations?.[lang]?.transWord;
	const existingTransDfn = word.translations?.[lang]?.transDfn ?? "";
	// Prompt A (case 1: gloss missing AND no description) already emits a Korean
	// definition, so only run the standalone definition call when case 1 won't.
	const case1MakesDefinition =
		wordNeedsTranslation && !word.definition && !existingTransDfn;
	const definitionNeeded = !word.definition && !case1MakesDefinition;

	return { missingRuHanja, wordNeedsTranslation, definitionNeeded };
}

// The single "is any AI call warranted" expression both callers need: the
// webhook to decide whether to schedule, the orchestrator as its `attempted`
// flag.
export function anyTranslationNeeded(needs: TranslationNeeds): boolean {
	return (
		needs.missingRuHanja.length > 0 ||
		needs.wordNeedsTranslation ||
		needs.definitionNeeded
	);
}
