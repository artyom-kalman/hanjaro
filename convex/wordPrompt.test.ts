import { describe, expect, test } from "bun:test";
import { buildWordPrompt, parseWordResponse } from "./wordPrompt.js";

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

  test("always asks for strict JSON output", () => {
    const prompt = buildWordPrompt(pureKorean, "en");
    expect(prompt).toContain(
      'Return strict JSON only: {"transWord":"...","transDfn":"..."}',
    );
  });
});

describe("parseWordResponse", () => {
  test("parses plain JSON", () => {
    expect(
      parseWordResponse('{"transWord":"газета","transDfn":"печатное издание"}'),
    ).toEqual({ transWord: "газета", transDfn: "печатное издание" });
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
