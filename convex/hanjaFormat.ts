import type { Doc } from "./_generated/dataModel.js";
import { escapeHtml, t, type Lang } from "./i18n.js";

export type HanjaDoc = Doc<"hanja"> | null;

export function pickHanjaMeanings(
  doc: NonNullable<HanjaDoc>,
  lang: Lang,
): { text: string }[] {
  const localized = lang === "ru" ? doc.translations?.ru : undefined;
  return localized && localized.length > 0 ? localized : doc.meanings;
}

export function hasMissingRuTranslation(doc: NonNullable<HanjaDoc>): boolean {
  return doc.meanings.length > 0 && !(doc.translations?.ru?.length);
}

// True when at least one rendered gloss came from the AI translation step
// (the `ru` branch of pickHanjaMeanings), so we only stamp the "translated by
// AI" footer on messages that actually contain machine-generated text — not on
// English source glosses or on failed translations that fell back to English.
function hasRenderedAiTranslation(docs: HanjaDoc[], lang: Lang): boolean {
  return lang === "ru" && docs.some((d) => (d?.translations?.ru?.length ?? 0) > 0);
}

export function formatHanjaBreakdown(
  docs: HanjaDoc[],
  chars: string[],
  lang: Lang,
): string {
  const lines: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const doc = docs[i];
    const char = chars[i]!;
    lines.push("");

    if (!doc || doc.meanings.length === 0) {
      lines.push(`<b>${escapeHtml(char)}</b> — ${t(lang).hanjaBreakdownNoData}`);
      continue;
    }

    lines.push(`<b>${escapeHtml(doc.character)}</b>`);
    for (const m of pickHanjaMeanings(doc, lang)) {
      lines.push(` · <i>${escapeHtml(m.text)}</i>`);
    }
    const readings: string[] = [];
    if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
    if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
    if (readings.length > 0) lines.push(readings.join("  "));
  }

  if (hasRenderedAiTranslation(docs, lang)) {
    lines.push("");
    lines.push(t(lang).aiTranslationNote);
  }

  return lines.join("\n");
}

export function formatHangulHanjaPage(
  syllable: string,
  pageDocs: NonNullable<HanjaDoc>[],
  page: number,
  totalPages: number,
  total: number,
  lang: Lang,
): string {
  const lines: string[] = [];
  lines.push(t(lang).hanjaPageHeader({ syllable, total, page, totalPages }));

  for (const doc of pageDocs) {
    lines.push("");
    const meaningText = pickHanjaMeanings(doc, lang)
      .map((m) => m.text)
      .join(", ");
    const meaningPart = meaningText ? `  ·  <i>${escapeHtml(meaningText)}</i>` : "";
    lines.push(`<b>${escapeHtml(doc.character)}</b>${meaningPart}`);
    const readings: string[] = [];
    if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
    if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
    if (readings.length > 0) lines.push(readings.join("  "));
  }

  if (hasRenderedAiTranslation(pageDocs, lang)) {
    lines.push("");
    lines.push(t(lang).aiTranslationNote);
  }

  return lines.join("\n");
}
