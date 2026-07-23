// Pure InlineKeyboard construction: no network, no Convex, no closure state.
// Imports grammy (InlineKeyboard), i18n (t/Lang) and hanjaFormat types only.
import { InlineKeyboard } from "grammy";
import {
	type DisplayResult,
	pickResultMeaning,
	pickTranslation,
} from "./hanjaFormat.js";
import { type Lang, t } from "./i18n.js";

const HANJA_WORD_ACTION_LIMIT = 3;
const HANJA_WORD_ACTION_LABEL_LIMIT = 60;

export function buildHangulHanjaKeyboard(
	syllable: string,
	page: number,
	totalPages: number,
	lang: Lang,
): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	if (totalPages > 1) {
		if (page > 0)
			keyboard.text(t(lang).buttons.prev, `hp:${syllable}:${page - 1}`);
		if (page < totalPages - 1)
			keyboard.text(t(lang).buttons.next, `hp:${syllable}:${page + 1}`);
	}
	return keyboard;
}

export function buildSyllableChoiceKeyboard(
	syllable: string,
	lang: Lang,
): InlineKeyboard {
	const ui = t(lang);
	return new InlineKeyboard()
		.text(ui.buttons.lookUpWord, `wq:${syllable}`)
		.text(ui.buttons.hanjaFor(syllable), `hh:${syllable}:0`);
}

export function buildMeaningKeyboard(
	matches: DisplayResult[],
	lang: Lang,
): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	for (const m of matches) {
		const origin = m.origin || "—";
		const picked = pickTranslation(m, lang);
		const meaning = picked?.translation.transWord || m.definition || "";
		let label = meaning ? `${origin} · ${meaning}` : origin;
		if (label.length > 60) label = `${label.slice(0, 59)}…`;
		keyboard.text(label, `m:${m.targetCode}`).row();
	}
	return keyboard;
}

export function buildHanjaWordKeyboard(
	examples: DisplayResult[],
	lang: Lang,
): InlineKeyboard {
	const keyboard = new InlineKeyboard();

	for (const example of examples.slice(0, HANJA_WORD_ACTION_LIMIT)) {
		const meaning = pickResultMeaning(example, lang);
		let label = meaning ? `${example.word} · ${meaning}` : example.word;

		if (label.length > HANJA_WORD_ACTION_LABEL_LIMIT) {
			label = `${label.slice(0, HANJA_WORD_ACTION_LABEL_LIMIT - 1)}…`;
		}

		keyboard.text(label, `wq:${example.word}`).row();
	}

	return keyboard;
}

export function buildSettingsKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text("🇬🇧 English", "lang:en")
		.text("🇷🇺 Русский", "lang:ru");
}

export function buildSuggestionsKeyboard(words: string[]): InlineKeyboard {
	const keyboard = new InlineKeyboard();
	for (const word of words) keyboard.text(word, `s:${word}`).row();
	return keyboard;
}

export function buildLangInitKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text("🇬🇧 English", "langinit:en")
		.text("🇷🇺 Русский", "langinit:ru");
}
