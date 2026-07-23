// Pure, network-free helper for turning a raw LLM reply into validated data.
// Kept free of any Convex / grammy / OpenAI imports so it's trivially
// unit-testable (see llmJson.test.ts). Some models wrap their JSON in ```json
// fences, so we strip those before parsing.
//
// Convention: returns null on ANY failure (malformed JSON, non-object garbage,
// or schema rejection). null means "unusable" — every caller degrades
// gracefully rather than throwing.
import type { z } from "zod";

export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): T | null {
	const stripped = raw
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "");

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped);
	} catch {
		return null;
	}

	const result = schema.safeParse(parsed);
	return result.success ? result.data : null;
}
