import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
});

// --- Types ---

export interface KrdictSearchResult {
	word: string;
	origin: string;
	targetCode: number;
	pos: string;
	definition: string;
	transWord: string;
	transDfn: string;
}

// --- Helpers ---

function asArray<T>(val: T | T[] | undefined): T[] {
	if (val === undefined) return [];
	return Array.isArray(val) ? val : [val];
}

async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
	for (let i = 0; i < retries; i++) {
		try {
			return await fetch(url);
		} catch (err) {
			if (i < retries - 1) {
				console.error(
					`Fetch failed (attempt ${i + 1}/${retries}), retrying in 1s...`,
				);
				await new Promise((r) => setTimeout(r, 1000));
			} else {
				throw err;
			}
		}
	}
	throw new Error("unreachable");
}

function parseSearchItem(item: Record<string, unknown>): KrdictSearchResult {
	const sense = item.sense as Record<string, unknown> | undefined;
	const trans = sense?.translation as Record<string, string> | undefined;
	return {
		word: (item.word as string | undefined) ?? "",
		origin: (item.origin as string | undefined) ?? "",
		targetCode: item.target_code as number,
		pos: (item.pos as string | undefined) ?? "",
		definition: (sense?.definition as string | undefined) ?? "",
		transWord: trans?.trans_word ?? "",
		transDfn: trans?.trans_dfn ?? "",
	};
}

async function fetchSearchItems(
	params: URLSearchParams,
	errorLabel: string,
): Promise<Record<string, unknown>[]> {
	const res = await fetchWithRetry(
		`https://krdict.korean.go.kr/api/search?${params}`,
	);
	if (!res.ok) {
		throw new Error(`${errorLabel}: ${res.status} ${res.statusText}`);
	}

	const xml = await res.text();
	const data = parser.parse(xml) as {
		channel?: { total?: number; item?: unknown };
	};
	const channel = data?.channel;

	if (!channel || channel.total === 0) return [];
	return asArray(channel.item) as Record<string, unknown>[];
}

function isHanjaWordExample(
	result: KrdictSearchResult,
	character: string,
): boolean {
	return (
		result.word.length > 0 &&
		result.origin.includes(character) &&
		/[\uAC00-\uD7AF]/.test(result.word)
	);
}

function collectHanjaExamples(
	items: Record<string, unknown>[],
	character: string,
	limit: number,
): KrdictSearchResult[] {
	const seen = new Set<number>();
	const examples: KrdictSearchResult[] = [];

	for (const item of items) {
		const result = parseSearchItem(item);
		if (!isHanjaWordExample(result, character)) continue;
		if (seen.has(result.targetCode)) continue;

		seen.add(result.targetCode);
		examples.push(result);
		if (examples.length >= limit) break;
	}

	return examples;
}

// --- Search ---

const TRANS_LANG_CODE: Record<"en" | "ru", string> = { en: "1", ru: "10" };

export async function searchWord(
	apiKey: string,
	query: string,
	lang: "en" | "ru" = "en",
): Promise<KrdictSearchResult[]> {
	const params = new URLSearchParams({
		key: apiKey,
		q: query,
		part: "word",
		sort: "dict",
		translated: "y",
		trans_lang: TRANS_LANG_CODE[lang],
		type2: "chinese",
	});

	const items = await fetchSearchItems(params, "krdict search failed");
	return items.map(parseSearchItem);
}

export async function searchHanjaExamples(
	apiKey: string,
	character: string,
	lang: "en" | "ru" = "en",
	limit = 5,
): Promise<KrdictSearchResult[]> {
	const params = new URLSearchParams({
		key: apiKey,
		q: character,
		part: "word",
		sort: "popular",
		translated: "y",
		trans_lang: TRANS_LANG_CODE[lang],
		advanced: "y",
		target: "4",
		lang: "2",
		method: "include",
		type2: "chinese",
		num: "20",
	});

	const items = await fetchSearchItems(params, "krdict hanja examples failed");
	return collectHanjaExamples(items, character, limit);
}
