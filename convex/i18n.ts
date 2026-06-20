// Centralized UI translations.
//
// To add a new language:
//   1. Add the literal to `Lang` below.
//   2. Add a matching entry to `STRINGS` — TypeScript will fail to compile
//      until every key is filled in.
//   3. Update the `lang` validator in `convex/schema.ts` AND
//      `convex/userSettings.ts` to include the new literal.
//   4. Add a button to `buildSettingsKeyboard` and a flag to `LANG_FLAG` in
//      `convex/telegram.ts`, plus a `language_code` block in
//      `convex/registerWebhook.ts`.

export type Lang = "en" | "ru";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface UIStrings {
  usage: string;
  loadingFrames: readonly [string, string, string, string];
  settingsPrompt: string;
  welcomePrompt: string;
  langConfirm: string;

  posMap: Record<string, string>;

  buttons: {
    lookUpWord: string;
    hanjaFor: (syllable: string) => string;
    prev: string;
    next: string;
  };

  syllableChoicePrompt: (syllable: string) => string;
  hanjaPageHeader: (args: {
    syllable: string;
    total: number;
    page: number;
    totalPages: number;
  }) => string;
  hanjaBreakdownNoData: string;
  hanjaTranslateFailed: string;
  aiTranslationNote: string;

  errors: {
    noResults: (word: string) => string;
    noExactMatch: (word: string) => string;
    multipleMeanings: (word: string) => string;
    noHanjaEntry: (char: string) => string;
    noHanjaForSyllable: (syllable: string) => string;
    multipleHanjaWarning: string;
    staleCache: string;
    generic: string;
    callback: string;
  };
}

const EN: UIStrings = {
  usage:
    "Send me a Korean word and I'll look it up in the dictionary.\n\n" +
    "Examples:\n" +
    "• 학생 — Korean word\n" +
    "• 장 — single syllable (I'll ask what you want)\n" +
    "• 學 — Hanja character",
  loadingFrames: [
    "Looking up.",
    "Looking up..",
    "Looking up...",
    "Looking up..",
  ],
  settingsPrompt: "Choose language:",
  welcomePrompt: "Welcome! Choose your language:",
  langConfirm: "English selected",

  posMap: {
    명사: "Noun",
    동사: "Verb",
    형용사: "Adjective",
    부사: "Adverb",
    감탄사: "Interjection",
    대명사: "Pronoun",
    수사: "Numeral",
    관형사: "Determiner",
    조사: "Particle",
    접사: "Affix",
    "의존 명사": "Dependent Noun",
    "보조 동사": "Auxiliary Verb",
    "보조 형용사": "Auxiliary Adjective",
  },

  buttons: {
    lookUpWord: "Look up word",
    hanjaFor: (s) => `Hanja for ${s}`,
    prev: "‹ Prev",
    next: "Next ›",
  },

  syllableChoicePrompt: (s) =>
    `<b>${escapeHtml(s)}</b> can mean a Korean word or share its reading with several Hanja.\n` +
    `What do you want?`,
  hanjaPageHeader: ({ syllable, total, page, totalPages }) => {
    const s = `<b>${escapeHtml(syllable)}</b>`;
    return totalPages > 1
      ? `Hanja for ${s}  ·  ${total} total  ·  page ${page + 1}/${totalPages}`
      : `Hanja for ${s}  ·  ${total} total`;
  },
  hanjaBreakdownNoData: "<i>no data</i>",
  hanjaTranslateFailed: "<i>(translation unavailable)</i>",
  aiTranslationNote: "<i>✨ Translated with AI</i>",

  errors: {
    noResults: (w) => `No results found for <b>${escapeHtml(w)}</b>.`,
    noExactMatch: (w) =>
      `No exact match for <b>${escapeHtml(w)}</b>.\nDid you mean:`,
    multipleMeanings: (w) => `Multiple meanings for <b>${escapeHtml(w)}</b>:`,
    noHanjaEntry: (c) => `No Hanja entry for ${escapeHtml(c)}.`,
    noHanjaForSyllable: (s) => `No Hanja found for ${escapeHtml(s)}.`,
    multipleHanjaWarning: "Please send one Hanja character at a time.",
    staleCache: "Meaning no longer cached, please search again.",
    generic: "Sorry, something went wrong. Please try again.",
    callback: "Lookup failed, please try again.",
  },
};

const RU: UIStrings = {
  usage:
    "Отправьте мне корейское слово, и я найду его в словаре.\n\n" +
    "Примеры:\n" +
    "• 학생 — корейское слово\n" +
    "• 장 — один слог (я уточню, что вам нужно)\n" +
    "• 學 — иероглиф ханча",
  loadingFrames: ["Ищу.", "Ищу..", "Ищу...", "Ищу.."],
  settingsPrompt: "Выберите язык:",
  welcomePrompt: "Добро пожаловать! Выберите язык:",
  langConfirm: "Язык: Русский",

  posMap: {
    명사: "Существительное",
    동사: "Глагол",
    형용사: "Прилагательное",
    부사: "Наречие",
    감탄사: "Междометие",
    대명사: "Местоимение",
    수사: "Числительное",
    관형사: "Определение",
    조사: "Частица",
    접사: "Аффикс",
    "의존 명사": "Зависимое существительное",
    "보조 동사": "Вспомогательный глагол",
    "보조 형용사": "Вспомогательное прилагательное",
  },

  buttons: {
    lookUpWord: "Найти слово",
    hanjaFor: (s) => `Ханча для ${s}`,
    prev: "‹ Назад",
    next: "Далее ›",
  },

  syllableChoicePrompt: (s) =>
    `<b>${escapeHtml(s)}</b> может быть корейским словом или совпадать по чтению с несколькими ханча.\n` +
    `Что вы ищете?`,
  hanjaPageHeader: ({ syllable, total, page, totalPages }) => {
    const s = `<b>${escapeHtml(syllable)}</b>`;
    return totalPages > 1
      ? `Ханча для ${s}  ·  всего ${total}  ·  стр. ${page + 1}/${totalPages}`
      : `Ханча для ${s}  ·  всего ${total}`;
  },
  hanjaBreakdownNoData: "<i>нет данных</i>",
  hanjaTranslateFailed: "<i>(перевод недоступен)</i>",
  aiTranslationNote: "<i>✨ Перевод с помощью ИИ</i>",

  errors: {
    noResults: (w) => `Ничего не найдено для <b>${escapeHtml(w)}</b>.`,
    noExactMatch: (w) =>
      `Точных совпадений для <b>${escapeHtml(w)}</b> нет.\nВозможно, вы имели в виду:`,
    multipleMeanings: (w) =>
      `Несколько значений для <b>${escapeHtml(w)}</b>:`,
    noHanjaEntry: (c) => `Иероглиф ${escapeHtml(c)} не найден.`,
    noHanjaForSyllable: (s) => `Для слога ${escapeHtml(s)} нет ханча.`,
    multipleHanjaWarning:
      "Пожалуйста, отправляйте по одному иероглифу за раз.",
    staleCache: "Значение больше не в кеше, выполните поиск заново.",
    generic: "Извините, произошла ошибка. Попробуйте ещё раз.",
    callback: "Не удалось выполнить поиск, попробуйте ещё раз.",
  },
};

const STRINGS: Record<Lang, UIStrings> = { en: EN, ru: RU };

export function t(lang: Lang): UIStrings {
  return STRINGS[lang];
}
