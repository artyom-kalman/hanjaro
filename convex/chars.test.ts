import { describe, expect, test } from "bun:test";
import {
	allHanja,
	hanjaOnly,
	isHangul,
	isHanja,
	toHanjaContext,
} from "./chars.js";
import type { HanjaDoc } from "./hanjaFormat.js";

describe("isHanja", () => {
	test("accepts the CJK block boundaries U+4E00 and U+9FFF inclusive", () => {
		expect(isHanja("一")).toBe(true);
		expect(isHanja("鿿")).toBe(true);
	});

	test("rejects code points just outside the block", () => {
		expect(isHanja("䷿")).toBe(false);
		expect(isHanja("ꀀ")).toBe(false);
	});

	test("rejects hangul and latin", () => {
		expect(isHanja("가")).toBe(false);
		expect(isHanja("a")).toBe(false);
	});
});

describe("isHangul", () => {
	test("accepts the Hangul range boundaries U+AC00 and U+D7AF inclusive", () => {
		expect(isHangul("가")).toBe(true);
		expect(isHangul("힯")).toBe(true);
	});

	test("rejects code points just outside the range", () => {
		expect(isHangul("꯿")).toBe(false);
		expect(isHangul("ힰ")).toBe(false);
	});

	test("rejects hanja and latin", () => {
		expect(isHangul("一")).toBe(false);
		expect(isHangul("a")).toBe(false);
	});
});

describe("allHanja", () => {
	test("true for a string of only hanja", () => {
		expect(allHanja("新聞")).toBe(true);
	});

	test("false when any character is not hanja", () => {
		expect(allHanja("新a")).toBe(false);
		expect(allHanja("신문")).toBe(false);
	});

	test("false for an empty string", () => {
		expect(allHanja("")).toBe(false);
	});
});

describe("hanjaOnly", () => {
	test("keeps only hanja characters, preserving order", () => {
		expect(hanjaOnly("新聞")).toEqual(["新", "聞"]);
	});

	test("filters hangul out of a mixed string", () => {
		expect(hanjaOnly("新신聞문")).toEqual(["新", "聞"]);
		expect(hanjaOnly("가新나聞다")).toEqual(["新", "聞"]);
	});

	test("returns an empty array for an empty string", () => {
		expect(hanjaOnly("")).toEqual([]);
	});

	test("returns an empty array when there are no hanja", () => {
		expect(hanjaOnly("신문")).toEqual([]);
	});
});

describe("toHanjaContext", () => {
	function doc(character: string, meanings: string[]): NonNullable<HanjaDoc> {
		return {
			character,
			meanings: meanings.map((text) => ({ text })),
		} as NonNullable<HanjaDoc>;
	}

	test("maps each doc to { character, englishMeanings }", () => {
		expect(
			toHanjaContext([
				doc("新", ["new", "fresh"]),
				doc("聞", ["hear", "news"]),
			]),
		).toEqual([
			{ character: "新", englishMeanings: ["new", "fresh"] },
			{ character: "聞", englishMeanings: ["hear", "news"] },
		]);
	});

	test("yields an empty englishMeanings array for a doc with no meanings", () => {
		expect(toHanjaContext([doc("水", [])])).toEqual([
			{ character: "水", englishMeanings: [] },
		]);
	});

	test("returns an empty array for no docs", () => {
		expect(toHanjaContext([])).toEqual([]);
	});
});
