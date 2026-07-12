import { describe, expect, test } from "bun:test";
import {
  formatHanjaExamples,
  formatSingleHanjaCard,
  shouldShowAiFooter,
  type DisplayResult,
  type HanjaDoc,
} from "./hanjaFormat.js";

// Minimal stand-ins — shouldShowAiFooter only reads translations, so we cast
// past the full Convex Doc<"hanja"> / row shapes.
function hanjaDoc(ru?: { text: string }[]): HanjaDoc {
  return {
    meanings: [{ text: "new", source: "unihan" }],
    translations: ru ? { ru } : undefined,
  } as unknown as HanjaDoc;
}

function wordResult(translations: DisplayResult["translations"]): DisplayResult {
  return { word: "신문", origin: "新聞", targetCode: 1, pos: "명사", definition: "", translations };
}

describe("shouldShowAiFooter", () => {
  test("true when a rendered Hanja gloss is AI (RU)", () => {
    const docs = [hanjaDoc([{ text: "газета" }])];
    expect(shouldShowAiFooter(docs, wordResult({}), "ru")).toBe(true);
  });

  test("true when the word translation is AI (RU)", () => {
    const result = wordResult({
      ru: { transWord: "газета", transDfn: "издание", source: "ai" },
    });
    expect(shouldShowAiFooter([hanjaDoc()], result, "ru")).toBe(true);
  });

  test("true when the word translation is AI (EN)", () => {
    const result = wordResult({
      en: { transWord: "newspaper", transDfn: "a publication", source: "ai" },
    });
    expect(shouldShowAiFooter([], result, "en")).toBe(true);
  });

  test("false for KrDict-only translations", () => {
    const result = wordResult({
      ru: { transWord: "газета", transDfn: "издание", source: "krdict" },
    });
    expect(shouldShowAiFooter([hanjaDoc()], result, "ru")).toBe(false);
  });

  test("false for a legacy row with no source marker", () => {
    const result = wordResult({ ru: { transWord: "газета", transDfn: "издание" } });
    expect(shouldShowAiFooter([hanjaDoc()], result, "ru")).toBe(false);
  });

  test("false for an English render even when a Russian Hanja gloss exists", () => {
    // English never AI-translates char glosses (Unihan is native), so a cached
    // Russian gloss must not stamp the footer on an English message.
    const docs = [hanjaDoc([{ text: "газета" }])];
    const result = wordResult({
      en: { transWord: "newspaper", transDfn: "a publication", source: "krdict" },
    });
    expect(shouldShowAiFooter(docs, result, "en")).toBe(false);
  });
});

describe("formatHanjaExamples", () => {
  test("renders Korean examples with Hanja origins and translated glosses", () => {
    const examples: DisplayResult[] = [
      {
        word: "일월",
        origin: "一月",
        targetCode: 2,
        pos: "명사",
        definition: "한 해 열두 달 가운데 첫째 달.",
        translations: {
          en: { transWord: "January", transDfn: "The first month of the year." },
        },
      },
    ];

    expect(formatHanjaExamples(examples, "en")).toBe(
      "\n<b>Examples in Korean words</b>\n" +
        " · <b>일월</b>  <code>一月</code> — January",
    );
  });

  test("falls back to the Korean definition when no translation is available", () => {
    const examples: DisplayResult[] = [
      {
        word: "일가",
        origin: "一家",
        targetCode: 3,
        pos: "명사",
        definition: "한집안.",
        translations: {},
      },
    ];

    expect(formatHanjaExamples(examples, "en")).toContain(" — 한집안.");
  });
});

describe("formatSingleHanjaCard", () => {
  test("renders a compact card with character, readings, and meanings", () => {
    const doc = {
      character: "學",
      hangul: "학",
      mandarin: "xué",
      meanings: [
        { text: "study", source: "unihan" },
        { text: "learning", source: "unihan" },
      ],
    } as unknown as NonNullable<HanjaDoc>;

    expect(formatSingleHanjaCard(doc, "en")).toBe(
      "<b>學</b>\n학 · xué\n<i>study · learning</i>",
    );
  });

  test("omits unavailable readings without leaving separators", () => {
    const doc = {
      character: "學",
      hangul: "학",
      mandarin: "",
      meanings: [{ text: "study", source: "unihan" }],
    } as unknown as NonNullable<HanjaDoc>;

    expect(formatSingleHanjaCard(doc, "en")).toBe(
      "<b>學</b>\n학\n<i>study</i>",
    );
  });

  test("uses Russian meanings and keeps the action heading before one AI footer", () => {
    const doc = {
      character: "學",
      hangul: "학",
      mandarin: "xué",
      meanings: [{ text: "study", source: "unihan" }],
      translations: { ru: [{ text: "учёба" }] },
    } as unknown as NonNullable<HanjaDoc>;

    expect(formatSingleHanjaCard(doc, "ru", "Изучите в слове")).toBe(
      "<b>學</b>\n학 · xué\n<i>учёба</i>\n\n" +
        "<b>Изучите в слове</b>\n\n<i>✨ Перевод с помощью ИИ</i>",
    );
  });

  test("uses the localized no-data fallback when meanings are absent", () => {
    const doc = {
      character: "學",
      hangul: "학",
      mandarin: "xué",
      meanings: [],
    } as unknown as NonNullable<HanjaDoc>;

    expect(formatSingleHanjaCard(doc, "en")).toBe(
      "<b>學</b>\n학 · xué\n<i>no data</i>",
    );
  });
});
