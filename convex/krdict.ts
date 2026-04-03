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

export async function searchWord(
  apiKey: string,
  query: string
): Promise<KrdictSearchResult[]> {
  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    part: "word",
    sort: "dict",
    translated: "y",
    trans_lang: "1",
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

