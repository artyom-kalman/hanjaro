import { XMLParser } from "fast-xml-parser";

const API_KEY = process.env.KRDICT_API_KEY;
if (!API_KEY) {
  console.error("KRDICT_API_KEY not set in environment");
  process.exit(1);
}

const word = process.argv[2];
if (!word) {
  console.error("Usage: bun scripts/krdict.ts <korean-word>");
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
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
const searchParams = new URLSearchParams({
  key: API_KEY,
  q: word,
  part: "word",
  sort: "dict",
  translated: "y",
  trans_lang: "1",
  type2: "chinese",
});

console.log(`\n===== Search: ${word} =====\n`);

const searchRes = await fetchWithRetry(
  `https://krdict.korean.go.kr/api/search?${searchParams}`
);
const searchXml = await searchRes.text();
const searchData = parser.parse(searchXml);

const channel = searchData?.channel;
if (!channel || channel.total === 0) {
  console.log("No results found.");
  process.exit(0);
}

// Normalize to array
const items = Array.isArray(channel.item) ? channel.item : [channel.item];

for (const item of items) {
  const trans = item.sense?.translation;
  console.log({
    word: item.word,
    origin: item.origin || "(none)",
    target_code: item.target_code,
    pos: item.pos,
    definition: item.sense?.definition,
    trans_word: trans?.trans_word,
    trans_dfn: trans?.trans_dfn,
  });
}

// --- View (first result) ---
const targetCode = items[0]?.target_code;
if (!targetCode) {
  console.log("\nNo target_code to look up.");
  process.exit(0);
}

console.log(`\n===== View: target_code=${targetCode} =====\n`);

const viewParams = new URLSearchParams({
  key: API_KEY,
  method: "target_code",
  q: String(targetCode),
  translated: "y",
  trans_lang: "1",
});

const viewRes = await fetchWithRetry(
  `https://krdict.korean.go.kr/api/view?${viewParams}`
);
const viewXml = await viewRes.text();
const viewData = parser.parse(viewXml);

const wordInfo = viewData?.channel?.item?.word_info;
if (!wordInfo) {
  console.log("No view data found.");
  console.log("Raw response:", JSON.stringify(viewData, null, 2));
  process.exit(0);
}

console.log("word:", wordInfo.word);
console.log("origin:", wordInfo.original_language_info?.original_language || "(none)");
console.log(
  "origin_type:",
  wordInfo.original_language_info?.language_type || "(none)"
);
console.log("pronunciation:", wordInfo.pronunciation_info?.pronunciation || "(none)");
console.log("word_type:", wordInfo.word_type);
console.log("grade:", wordInfo.word_grade);

// Senses (at word_info level, not nested under pos_info)
const senseInfo = wordInfo.sense_info;
const senses = senseInfo
  ? Array.isArray(senseInfo)
    ? senseInfo
    : [senseInfo]
  : [];

console.log(`\n--- Senses (${senses.length}) ---`);
for (const sense of senses) {
  const trans = sense.translation;
  console.log({
    definition: sense.definition,
    trans_word: trans?.trans_word,
    trans_dfn: trans?.trans_dfn,
  });
  // Related words per sense
  if (sense.rel_info) {
    const rels = Array.isArray(sense.rel_info) ? sense.rel_info : [sense.rel_info];
    for (const rel of rels) {
      console.log(`  related: ${rel.word} (${rel.type})`);
    }
  }
}

// Derived words (der_info at word_info level)
const derInfo = wordInfo.der_info;
if (derInfo) {
  const ders = Array.isArray(derInfo) ? derInfo : [derInfo];
  console.log(`\n--- Derived words (${ders.length}) ---`);
  for (const der of ders) {
    console.log({ word: der.word, target_code: der.link_target_code });
  }
}

// Print full raw view data for exploration
console.log("\n===== Raw view data =====\n");
console.log(JSON.stringify(viewData, null, 2));
