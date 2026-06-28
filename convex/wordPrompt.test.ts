import { describe, expect, test } from "bun:test";
import {
  buildDefinitionPrompt,
  buildGlossFromDescriptionPrompt,
  buildWordPrompt,
  parseDefinitionResponse,
  parseWordResponse,
} from "./wordPrompt.js";

describe("buildWordPrompt", () => {
  const pureKorean = {
    word: "낯설다",
    pos: "형용사",
    definition: "전에 본 적이 없어 익숙하지 않다",
    hanjaContext: [],
  };

  test("interpolates English as the target language", () => {
    const prompt = buildWordPrompt(pureKorean, "en");
    expect(prompt).toContain("Translate a Korean dictionary word into English.");
  });

  test("interpolates Russian as the target language", () => {
    const prompt = buildWordPrompt(pureKorean, "ru");
    expect(prompt).toContain("Translate a Korean dictionary word into Russian.");
  });

  test("includes the word, POS, and Korean definition", () => {
    const prompt = buildWordPrompt(pureKorean, "ru");
    expect(prompt).toContain("Word: 낯설다");
    expect(prompt).toContain("Part of speech: 형용사");
    expect(prompt).toContain("Korean definition: 전에 본 적이 없어 익숙하지 않다");
  });

  test("asks for gloss, meaning translation, and Korean definition", () => {
    const prompt = buildWordPrompt(pureKorean, "en");
    expect(prompt).toContain(
      "Provide (1) a concise gloss (dictionary-style, one word / short phrase),",
    );
    expect(prompt).toContain(
      "(2) a translation of the meaning into English, and",
    );
    expect(prompt).toContain(
      "(3) a short Korean-language definition (한국어 뜻풀이) of the word.",
    );
    expect(prompt).toContain("Use the Hanja origin to fix the precise sense.");
    expect(prompt).not.toContain("and the Korean definition");
  });

  test("includes a Hanja block for Hanja-origin words", () => {
    const prompt = buildWordPrompt(
      {
        word: "신문",
        pos: "명사",
        definition: "새 소식을 전하는 간행물",
        hanjaContext: [
          { character: "新", englishMeanings: ["new", "fresh"] },
          { character: "聞", englishMeanings: ["hear", "news"] },
        ],
      },
      "en",
    );
    expect(prompt).toContain("Hanja: 新聞");
    expect(prompt).toContain("新 = new, fresh");
    expect(prompt).toContain("聞 = hear, news");
  });

  test("omits the Hanja block for pure Korean words", () => {
    const prompt = buildWordPrompt(pureKorean, "ru");
    expect(prompt).not.toContain("Hanja:");
  });

  test("always asks for strict JSON output with definition field", () => {
    const prompt = buildWordPrompt(pureKorean, "en");
    expect(prompt).toContain('"definition":"<Korean text only>"');
    expect(prompt).toContain('"transWord":"<English gloss>"');
    expect(prompt).toContain('"transDfn":"<English meaning translation>"');
  });
});

describe("buildGlossFromDescriptionPrompt", () => {
  const grounded = {
    word: "유가",
    pos: "명사",
    description: "기름의 가격",
    hanjaContext: [
      { character: "油", englishMeanings: ["oil"] },
      { character: "價", englishMeanings: ["price", "value"] },
    ],
  };

  test("interpolates target language", () => {
    const prompt = buildGlossFromDescriptionPrompt(grounded, "en");
    expect(prompt).toContain(
      "Give a concise dictionary gloss for a Korean word in English.",
    );
  });

  test("asks for a gloss only, not a sentence", () => {
    const prompt = buildGlossFromDescriptionPrompt(grounded, "ru");
    expect(prompt).toContain(
      "Output ONE word or a short phrase — the gloss only, not a sentence.",
    );
    expect(prompt).toContain("Use the definition below to pick the exact sense.");
    expect(prompt).toContain("Definition: 기름의 가격");
  });

  test("includes word and POS", () => {
    const prompt = buildGlossFromDescriptionPrompt(grounded, "en");
    expect(prompt).toContain("Word: 유가");
    expect(prompt).toContain("Part of speech: 명사");
  });

  test("includes Hanja block when present", () => {
    const prompt = buildGlossFromDescriptionPrompt(grounded, "en");
    expect(prompt).toContain("Hanja: 油價");
    expect(prompt).toContain("油 = oil");
    expect(prompt).toContain("價 = price, value");
  });

  test("omits Hanja block for pure Korean words", () => {
    const prompt = buildGlossFromDescriptionPrompt(
      {
        word: "낯설다",
        pos: "형용사",
        description: "전에 본 적이 없어 익숙하지 않다",
        hanjaContext: [],
      },
      "en",
    );
    expect(prompt).not.toContain("Hanja:");
  });

  test("asks for transWord-only JSON", () => {
    const prompt = buildGlossFromDescriptionPrompt(grounded, "en");
    expect(prompt).toContain('Return strict JSON only: {"transWord":"..."}');
  });
});

describe("parseWordResponse", () => {
  test("parses plain JSON", () => {
    expect(
      parseWordResponse('{"transWord":"газета","transDfn":"печатное издание"}'),
    ).toEqual({ transWord: "газета", transDfn: "печатное издание" });
  });

  test("parses optional definition when present", () => {
    expect(
      parseWordResponse(
        '{"definition":"혼합된 혈액","transWord":"mixed blood","transDfn":"blood of mixed ancestry"}',
      ),
    ).toEqual({
      definition: "혼합된 혈액",
      transWord: "mixed blood",
      transDfn: "blood of mixed ancestry",
    });
  });

  test("omits definition when empty or whitespace", () => {
    expect(
      parseWordResponse('{"definition":"","transWord":"test","transDfn":"x"}'),
    ).toEqual({ transWord: "test", transDfn: "x" });
    expect(
      parseWordResponse('{"definition":"   ","transWord":"test","transDfn":"x"}'),
    ).toEqual({ transWord: "test", transDfn: "x" });
  });

  test("defaults transDfn to empty when absent", () => {
    expect(parseWordResponse('{"transWord":"oil price"}')).toEqual({
      transWord: "oil price",
      transDfn: "",
    });
  });

  test("strips ```json fences", () => {
    const raw =
      '```json\n{"transWord":"newspaper","transDfn":"a daily publication"}\n```';
    expect(parseWordResponse(raw)).toEqual({
      transWord: "newspaper",
      transDfn: "a daily publication",
    });
  });

  test("strips bare ``` fences", () => {
    const raw = '```\n{"transWord":"newspaper","transDfn":""}\n```';
    expect(parseWordResponse(raw)).toEqual({
      transWord: "newspaper",
      transDfn: "",
    });
  });

  test("trims whitespace inside fields", () => {
    expect(
      parseWordResponse('{"transWord":"  газета  ","transDfn":"  опр  "}'),
    ).toEqual({ transWord: "газета", transDfn: "опр" });
    expect(
      parseWordResponse(
        '{"definition":"  혼합  ","transWord":"  test  ","transDfn":"  dfn  "}',
      ),
    ).toEqual({
      definition: "혼합",
      transWord: "test",
      transDfn: "dfn",
    });
  });

  test("returns null when transWord is empty or whitespace", () => {
    expect(parseWordResponse('{"transWord":"","transDfn":"x"}')).toBeNull();
    expect(parseWordResponse('{"transWord":"   ","transDfn":"x"}')).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(parseWordResponse("not json at all")).toBeNull();
    expect(parseWordResponse('{"transWord": ')).toBeNull();
  });

  test("returns null for a non-object payload", () => {
    expect(parseWordResponse('"just a string"')).toBeNull();
    expect(parseWordResponse("null")).toBeNull();
  });
});

describe("buildDefinitionPrompt", () => {
  const input = {
    word: "황금",
    pos: "명사",
    hanjaContext: [
      { character: "黃", englishMeanings: ["yellow"] },
      { character: "金", englishMeanings: ["gold", "metal"] },
    ],
    meaning: "золото",
  };

  test("asks for a Korean definition only", () => {
    const prompt = buildDefinitionPrompt(input, "ru");
    expect(prompt).toContain("한국어 뜻풀이");
    expect(prompt).toContain('Return strict JSON only: {"definition":');
    expect(prompt).not.toContain("transWord");
  });

  test("grounds on the existing meaning with the language label", () => {
    expect(buildDefinitionPrompt(input, "ru")).toContain(
      "Meaning (Russian): золото",
    );
    expect(buildDefinitionPrompt(input, "en")).toContain("Meaning (English):");
  });

  test("includes the Hanja block and omits the meaning line when empty", () => {
    const prompt = buildDefinitionPrompt({ ...input, meaning: "" }, "ru");
    expect(prompt).toContain("Hanja: 黃金");
    expect(prompt).not.toContain("Meaning (");
  });
});

describe("parseDefinitionResponse", () => {
  test("parses a definition, tolerating fences and whitespace", () => {
    expect(parseDefinitionResponse('{"definition":"황금빛 금속"}')).toEqual({
      definition: "황금빛 금속",
    });
    expect(
      parseDefinitionResponse('```json\n{"definition":"  금  "}\n```'),
    ).toEqual({ definition: "금" });
  });

  test("returns null on empty definition or malformed input", () => {
    expect(parseDefinitionResponse('{"definition":""}')).toBeNull();
    expect(parseDefinitionResponse('{"definition":"   "}')).toBeNull();
    expect(parseDefinitionResponse("not json")).toBeNull();
    expect(parseDefinitionResponse("null")).toBeNull();
  });
});
