import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

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

// --- Fetch with retry ---

async function fetchWithRetry(url: string, retries = 5): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (i < retries - 1) {
        console.error(`Fetch failed (attempt ${i + 1}/${retries}), retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        throw err;
      }
    }
  }
  throw new Error("unreachable");
}

// --- Search ---

const TRANS_LANG_CODE: Record<"en" | "ru", string> = { en: "1", ru: "10" };

export async function searchWord(
  apiKey: string,
  query: string,
  lang: "en" | "ru" = "en"
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

  const res = await fetchWithRetry(
    `https://krdict.korean.go.kr/api/search?${params}`
  );
  if (!res.ok) {
    throw new Error(`krdict search failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const data = parser.parse(xml);
  const channel = data?.channel;

  if (!channel || channel.total === 0) return [];

  return asArray(channel.item).map((item: any) => {
    const trans = item.sense?.translation;
    return {
      word: item.word ?? "",
      origin: item.origin ?? "",
      targetCode: item.target_code,
      pos: item.pos ?? "",
      definition: item.sense?.definition ?? "",
      transWord: trans?.trans_word ?? "",
      transDfn: trans?.trans_dfn ?? "",
    };
  });
}

export async function searchHanjaExamples(
  apiKey: string,
  character: string,
  lang: "en" | "ru" = "en",
  limit = 5
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

  const res = await fetchWithRetry(
    `https://krdict.korean.go.kr/api/search?${params}`
  );
  if (!res.ok) {
    throw new Error(`krdict hanja examples failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const data = parser.parse(xml);
  const channel = data?.channel;

  if (!channel || channel.total === 0) return [];

  const seen = new Set<number>();
  const examples: KrdictSearchResult[] = [];
  for (const item of asArray(channel.item)) {
    const trans = item.sense?.translation;
    const result = {
      word: item.word ?? "",
      origin: item.origin ?? "",
      targetCode: item.target_code,
      pos: item.pos ?? "",
      definition: item.sense?.definition ?? "",
      transWord: trans?.trans_word ?? "",
      transDfn: trans?.trans_dfn ?? "",
    };
    if (!result.word || !result.origin.includes(character)) continue;
    if (!/[\uAC00-\uD7AF]/.test(result.word)) continue;
    if (seen.has(result.targetCode)) continue;
    seen.add(result.targetCode);
    examples.push(result);
    if (examples.length >= limit) break;
  }
  return examples;
}

