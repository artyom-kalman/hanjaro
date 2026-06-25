import { describe, expect, test } from "bun:test";
import {
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
