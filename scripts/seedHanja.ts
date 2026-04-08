import { execSync } from "child_process";

const isProd = process.argv.includes("--prod");
const convexFlag = isProd ? "--prod " : "";
if (isProd) {
  console.log("⚠  TARGETING PRODUCTION DEPLOYMENT");
} else {
  console.log("Target deployment: dev");
}

type Meaning = { text: string; source: "unihan" | "override" };
type RawEntry = {
  unihanDefs?: string[];
  hangul?: string;
  korean?: string;
  mandarin?: string;
};
type SeedEntry = {
  character: string;
  meanings: Meaning[];
  hangul?: string;
  korean?: string;
  mandarin?: string;
};
type OverridesFile = {
  overrides: Record<string, { meanings?: string[] }>;
};

// --- Load Unihan ---
const text = await Bun.file("data/Unihan_Readings.txt").text();

const charData = new Map<string, RawEntry>();

for (const line of text.split("\n")) {
  if (!line.startsWith("U+")) continue;
  const [codepoint, field, ...rest] = line.split("\t");
  const value = rest.join("\t");
  const char = String.fromCodePoint(parseInt(codepoint.slice(2), 16));

  if (!charData.has(char)) charData.set(char, {});
  const entry = charData.get(char)!;

  switch (field) {
    case "kDefinition":
      // Keep ALL meanings, split on comma or semicolon, drop empties
      entry.unihanDefs = value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      break;
    case "kHangul":
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

// --- Load manual overrides ---
const overridesRaw = await Bun.file("data/hanja-overrides.json").text();
const overridesFile = JSON.parse(overridesRaw) as OverridesFile;
const overrides = overridesFile.overrides ?? {};
console.log(`Loaded ${Object.keys(overrides).length} override entries`);

// --- Merge: every char that exists in Unihan OR overrides ---
const allChars = new Set<string>([
  ...charData.keys(),
  ...Object.keys(overrides),
]);

const entries: SeedEntry[] = [];

for (const character of allChars) {
  const raw = charData.get(character) ?? {};
  const override = overrides[character];

  const meanings: Meaning[] = [];
  const seen = new Set<string>();

  // Overrides first, in file order
  if (override?.meanings) {
    for (const text of override.meanings) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      meanings.push({ text: trimmed, source: "override" });
    }
  }

  // Then Unihan, skipping duplicates (case-insensitive)
  if (raw.unihanDefs) {
    for (const text of raw.unihanDefs) {
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      meanings.push({ text, source: "unihan" });
    }
  }

  if (meanings.length === 0) continue;

  entries.push({
    character,
    meanings,
    ...(raw.hangul && { hangul: raw.hangul }),
    ...(raw.korean && { korean: raw.korean }),
    ...(raw.mandarin && { mandarin: raw.mandarin }),
  });
}

console.log(`Prepared ${entries.length} characters with meanings`);

// --- Wipe existing hanja table before reseed (schema changed) ---
console.log("Clearing existing hanja table...");
execSync(`bunx convex run ${convexFlag}hanja:clearAll '{}'`, { stdio: "inherit" });

// --- Seed in batches ---
// Keep BATCH_SIZE small: JSON is passed as a shell argument and Linux's
// argv limit (~128KB) will kill the process on dense batches at 500.
const BATCH_SIZE = 100;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);
  execSync(
    `bunx convex run ${convexFlag}hanja:seedBatch '${JSON.stringify({ entries: batch }).replace(/'/g, "'\\''")}'`,
    { stdio: "inherit" }
  );
  console.log(`Seeded ${Math.min(i + BATCH_SIZE, entries.length)} / ${entries.length}`);
}

console.log("Done!");
