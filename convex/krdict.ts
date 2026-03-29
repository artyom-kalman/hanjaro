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

export interface KrdictSense {
  definition: string;
  transWord: string;
  transDfn: string;
  relatedWords: { word: string; type: string }[];
}

export interface KrdictViewResult {
  word: string;
  origin: string;
  originType: string;
  pronunciation: string;
  wordType: string;
  grade: string;
  senses: KrdictSense[];
  derivedWords: { word: string; targetCode: number }[];
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

  const res = await fetch(
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

// --- View ---

export async function viewEntry(
  apiKey: string,
  targetCode: number
): Promise<KrdictViewResult | null> {
  const params = new URLSearchParams({
    key: apiKey,
    method: "target_code",
    q: String(targetCode),
    translated: "y",
    trans_lang: "1",
  });

  const res = await fetch(
    `https://krdict.korean.go.kr/api/view?${params}`
  );
  if (!res.ok) {
    throw new Error(`krdict view failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const data = parser.parse(xml);
  const wordInfo = data?.channel?.item?.word_info;

  if (!wordInfo) return null;

  const senses = asArray(wordInfo.sense_info).map((sense: any) => {
    const trans = sense.translation;
    return {
      definition: sense.definition ?? "",
      transWord: trans?.trans_word ?? "",
      transDfn: trans?.trans_dfn ?? "",
      relatedWords: asArray(sense.rel_info).map((rel: any) => ({
        word: rel.word ?? "",
        type: rel.type ?? "",
      })),
    };
  });

  const derivedWords = asArray(wordInfo.der_info).map((der: any) => ({
    word: der.word ?? "",
    targetCode: der.link_target_code,
  }));

  return {
    word: wordInfo.word ?? "",
    origin:
      wordInfo.original_language_info?.original_language ?? "",
    originType:
      wordInfo.original_language_info?.language_type ?? "",
    pronunciation:
      wordInfo.pronunciation_info?.pronunciation ?? "",
    wordType: wordInfo.word_type ?? "",
    grade: wordInfo.word_grade ?? "",
    senses,
    derivedWords,
  };
}
