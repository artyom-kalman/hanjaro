import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseLlmJson } from "./llmJson.js";

const wordSchema = z.object({
	transWord: z.string(),
	transDfn: z.string(),
});

describe("parseLlmJson", () => {
	test("parses clean JSON matching the schema", () => {
		expect(
			parseLlmJson(
				'{"transWord":"газета","transDfn":"печатное издание"}',
				wordSchema,
			),
		).toEqual({ transWord: "газета", transDfn: "печатное издание" });
	});

	test("strips ```json fences before parsing", () => {
		const raw =
			'```json\n{"transWord":"newspaper","transDfn":"a daily publication"}\n```';
		expect(parseLlmJson(raw, wordSchema)).toEqual({
			transWord: "newspaper",
			transDfn: "a daily publication",
		});
	});

	test("strips bare ``` fences without a language tag", () => {
		const raw = '```\n{"transWord":"newspaper","transDfn":""}\n```';
		expect(parseLlmJson(raw, wordSchema)).toEqual({
			transWord: "newspaper",
			transDfn: "",
		});
	});

	test("tolerates leading/trailing whitespace", () => {
		const raw = '   \n  {"transWord":"oil","transDfn":"기름"}  \n  ';
		expect(parseLlmJson(raw, wordSchema)).toEqual({
			transWord: "oil",
			transDfn: "기름",
		});
	});

	test("returns null for malformed JSON", () => {
		expect(parseLlmJson("not json at all", wordSchema)).toBeNull();
		expect(parseLlmJson('{"transWord": ', wordSchema)).toBeNull();
	});

	test("returns null for a non-object payload", () => {
		expect(parseLlmJson('"just a string"', wordSchema)).toBeNull();
		expect(parseLlmJson("null", wordSchema)).toBeNull();
		expect(parseLlmJson("42", wordSchema)).toBeNull();
	});

	test("returns null when valid JSON fails the schema", () => {
		// missing transDfn
		expect(parseLlmJson('{"transWord":"газета"}', wordSchema)).toBeNull();
		// wrong type
		expect(
			parseLlmJson('{"transWord":123,"transDfn":"x"}', wordSchema),
		).toBeNull();
	});

	test("supports schemas with optional fields", () => {
		const optionalSchema = z.object({
			definition: z.string(),
			note: z.string().optional(),
		});
		expect(parseLlmJson('{"definition":"뜻"}', optionalSchema)).toEqual({
			definition: "뜻",
		});
		expect(
			parseLlmJson('{"definition":"뜻","note":"extra"}', optionalSchema),
		).toEqual({ definition: "뜻", note: "extra" });
	});

	test("applies schema transforms through the generic", () => {
		const trimmedSchema = z.object({
			transWord: z.string().transform((s) => s.trim()),
		});
		expect(parseLlmJson('{"transWord":"  газета  "}', trimmedSchema)).toEqual({
			transWord: "газета",
		});
	});

	test("works with record-of-string-array schemas", () => {
		const glossSchema = z.record(z.string(), z.array(z.string()));
		expect(
			parseLlmJson('{"新":["new","fresh"],"聞":["hear","news"]}', glossSchema),
		).toEqual({ 新: ["new", "fresh"], 聞: ["hear", "news"] });
		// non-string-array value rejected
		expect(parseLlmJson('{"新":"new"}', glossSchema)).toBeNull();
	});
});
