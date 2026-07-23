import { describe, expect, test } from "bun:test";
import {
	buildCharGlossPrompt,
	buildDefinitionPrompt,
	buildGlossFromDescriptionPrompt,
	buildWordPrompt,
	type CharInput,
	type ExampleWord,
	parseCharGlossResponse,
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
		expect(prompt).toContain(
			"Translate a Korean dictionary word into English.",
		);
	});

	test("interpolates Russian as the target language", () => {
		const prompt = buildWordPrompt(pureKorean, "ru");
		expect(prompt).toContain(
			"Translate a Korean dictionary word into Russian.",
		);
	});

	test("includes the word, POS, and Korean definition", () => {
		const prompt = buildWordPrompt(pureKorean, "ru");
		expect(prompt).toContain("Word: 낯설다");
		expect(prompt).toContain("Part of speech: 형용사");
		expect(prompt).toContain(
			"Korean definition: 전에 본 적이 없어 익숙하지 않다",
		);
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
		expect(prompt).toContain(
			"Use the definition below to pick the exact sense.",
		);
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
			parseWordResponse(
				'{"definition":"   ","transWord":"test","transDfn":"x"}',
			),
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

describe("buildCharGlossPrompt", () => {
	const header = [
		"Translate Korean Hanja (Chinese character) glosses from English to Russian.",
		"For each character, translate each English meaning into a single concise Russian word",
		"or short phrase, dictionary-style. Keep the same number of glosses per character.",
		"When example words are provided, use them to ground the meaning — the Russian gloss",
		"should be consistent with how the character is used in those words.",
		"",
		"Characters:",
	].join("\n");
	const footer = [
		"Return strict JSON only, no preamble. Keys are the characters above,",
		"values are arrays of Russian glosses. Example shape:",
		'{"正":["правильный","надлежащий","верный"]}',
	].join("\n");

	test("renders full prompt with hangul/mandarin context and example words", () => {
		const chars: CharInput[] = [
			{
				character: "正",
				hangul: "정",
				mandarin: "zhèng",
				englishMeanings: ["correct", "proper"],
			},
		];
		const examples = new Map<string, ExampleWord[]>([
			["正", [{ word: "正直", transWord: "честность" }]],
		]);
		expect(buildCharGlossPrompt(chars, examples)).toBe(
			`${header}\n- 正 (Korean: 정, Pinyin: zhèng): correct, proper\n  Example words: 正直 = честность\n\n${footer}`,
		);
	});

	test("omits the context parenthetical and example line when absent", () => {
		const chars: CharInput[] = [
			{ character: "山", englishMeanings: ["mountain"] },
		];
		expect(buildCharGlossPrompt(chars, new Map())).toBe(
			`${header}\n- 山: mountain\n\n${footer}`,
		);
	});

	test("includes only Korean context when mandarin is missing", () => {
		const chars: CharInput[] = [
			{ character: "水", hangul: "수", englishMeanings: ["water"] },
		];
		const prompt = buildCharGlossPrompt(chars, new Map());
		expect(prompt).toContain("- 水 (Korean: 수): water");
		expect(prompt).not.toContain("Pinyin");
	});

	test("includes only Pinyin context when hangul is missing", () => {
		const chars: CharInput[] = [
			{ character: "火", mandarin: "huǒ", englishMeanings: ["fire"] },
		];
		const prompt = buildCharGlossPrompt(chars, new Map());
		expect(prompt).toContain("- 火 (Pinyin: huǒ): fire");
		expect(prompt).not.toContain("Korean:");
	});

	test("joins multiple example words with commas", () => {
		const chars: CharInput[] = [
			{ character: "水", englishMeanings: ["water"] },
		];
		const examples = new Map<string, ExampleWord[]>([
			[
				"水",
				[
					{ word: "水泳", transWord: "плавание" },
					{ word: "水分", transWord: "влага" },
				],
			],
		]);
		expect(buildCharGlossPrompt(chars, examples)).toContain(
			"  Example words: 水泳 = плавание, 水分 = влага",
		);
	});
});

describe("parseCharGlossResponse", () => {
	const chars: CharInput[] = [
		{ character: "正", englishMeanings: ["correct"] },
		{ character: "直", englishMeanings: ["straight"] },
	];

	test("parses glosses keyed by character (happy path)", () => {
		const result = parseCharGlossResponse(
			'{"正":["правильный","верный"],"直":["прямой"]}',
			chars,
		);
		expect(result).not.toBeNull();
		expect(result).toEqual(
			new Map([
				["正", ["правильный", "верный"]],
				["直", ["прямой"]],
			]),
		);
	});

	test("strips ```json fences", () => {
		const result = parseCharGlossResponse(
			'```json\n{"正":["правильный"]}\n```',
			chars,
		);
		expect(result).toEqual(new Map([["正", ["правильный"]]]));
	});

	test("skips characters missing from the reply", () => {
		const result = parseCharGlossResponse('{"正":["правильный"]}', chars);
		expect(result).toEqual(new Map([["正", ["правильный"]]]));
		expect(result?.has("直")).toBe(false);
	});

	test("skips a character whose value is not an array", () => {
		const result = parseCharGlossResponse(
			'{"正":"правильный","直":["прямой"]}',
			chars,
		);
		expect(result).toEqual(new Map([["直", ["прямой"]]]));
	});

	test("filters out non-string glosses and drops the char if none remain", () => {
		const result = parseCharGlossResponse(
			'{"正":[1,null,"верный"],"直":[42,true]}',
			chars,
		);
		expect(result).toEqual(new Map([["正", ["верный"]]]));
	});

	test("trims whitespace and drops empty glosses", () => {
		const result = parseCharGlossResponse(
			'{"正":["  правильный  ","   ",""],"直":["прямой"]}',
			chars,
		);
		expect(result).toEqual(
			new Map([
				["正", ["правильный"]],
				["直", ["прямой"]],
			]),
		);
	});

	test("returns null on malformed JSON", () => {
		expect(parseCharGlossResponse("not json at all", chars)).toBeNull();
		expect(parseCharGlossResponse('{"正": ', chars)).toBeNull();
	});

	test("returns null on a non-object payload", () => {
		expect(parseCharGlossResponse('"just a string"', chars)).toBeNull();
		expect(parseCharGlossResponse("null", chars)).toBeNull();
	});
});
