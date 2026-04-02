import { execSync } from "child_process";

const text = await Bun.file("data/Unihan_Readings.txt").text();

// Parse all entries grouped by codepoint
const charData = new Map<
  string,
  { definition?: string; hangul?: string; korean?: string; mandarin?: string }
>();

for (const line of text.split("\n")) {
  if (!line.startsWith("U+")) continue;
  const [codepoint, field, ...rest] = line.split("\t");
  const value = rest.join("\t");
  const char = String.fromCodePoint(parseInt(codepoint.slice(2), 16));

  if (!charData.has(char)) charData.set(char, {});
  const entry = charData.get(char)!;

  switch (field) {
    case "kDefinition":
      // Take first meaning before comma or semicolon
      entry.definition = value.split(/[,;]/)[0].trim();
      break;
    case "kHangul":
      // Strip suffix like ":0E"
      entry.hangul = value.split(":")[0];
      break;
    case "kKorean":
      entry.korean = value;
      break;
    case "kMandarin":
      entry.mandarin = value;
      break;
  }
}

// Filter to characters that have at least a definition
const entries = [...charData.entries()]
  .filter(([, d]) => d.definition)
  .map(([character, d]) => ({
    character,
    definition: d.definition!,
    ...(d.hangul && { hangul: d.hangul }),
    ...(d.korean && { korean: d.korean }),
    ...(d.mandarin && { mandarin: d.mandarin }),
  }));

console.log(`Parsed ${entries.length} characters with definitions`);

// Seed into Convex using `bunx convex run` (calls internal mutation)
const BATCH_SIZE = 500;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);
  const args = JSON.stringify({ entries: batch });
  execSync(`bunx convex run hanja:seedBatch '${args.replace(/'/g, "'\\''")}'`, {
    stdio: "inherit",
  });
  console.log(`Seeded ${Math.min(i + BATCH_SIZE, entries.length)} / ${entries.length}`);
}

console.log("Done!");
