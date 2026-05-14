import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

const langValidator = v.union(v.literal("en"), v.literal("ru"));

const krdictEntry = {
  word: v.string(),
  origin: v.string(),
  targetCode: v.number(),
  pos: v.string(),
  definition: v.string(),
  transWord: v.string(),
  transDfn: v.string(),
};

export const getAllByWord = internalQuery({
  args: { word: v.string() },
  handler: async (ctx, { word }) => {
    return await ctx.db
      .query("words")
      .withIndex("by_word", (q) => q.eq("word", word))
      .collect();
  },
});

export const getByTargetCode = internalQuery({
  args: { targetCode: v.number() },
  handler: async (ctx, { targetCode }) => {
    return await ctx.db
      .query("words")
      .withIndex("by_target_code", (q) => q.eq("targetCode", targetCode))
      .first();
  },
});

// For each requested character, returns up to `limit` cached words containing
// that character whose translation is available in `lang`. Used by translate.ts
// to ground per-character LLM translations with real usage examples.
//
// NOTE: scans the full `words` table. Fine while the cache is small (low
// thousands). If it grows, consider a search index on `origin` or maintain a
// hanja → words secondary table.
export const getExamplesForCharacters = internalQuery({
  args: {
    characters: v.array(v.string()),
    lang: v.literal("ru"),
    limit: v.number(),
  },
  handler: async (ctx, { characters, lang, limit }) => {
    if (characters.length === 0) return [];
    const allWords = await ctx.db.query("words").collect();
    const result: {
      character: string;
      examples: { word: string; transWord: string }[];
    }[] = [];
    for (const ch of characters) {
      const matches: { word: string; transWord: string }[] = [];
      for (const w of allWords) {
        if (matches.length >= limit) break;
        if (!w.origin || !w.origin.includes(ch)) continue;
        const tr = w.translations[lang];
        if (!tr || !tr.transWord) continue;
        matches.push({ word: w.word, transWord: tr.transWord });
      }
      result.push({ character: ch, examples: matches });
    }
    return result;
  },
});

export const saveMany = internalMutation({
  args: {
    entries: v.array(v.object(krdictEntry)),
    lang: langValidator,
  },
  handler: async (ctx, { entries, lang }) => {
    for (const entry of entries) {
      const { transWord, transDfn, ...base } = entry;
      const translation = { transWord, transDfn };
      const existing = await ctx.db
        .query("words")
        .withIndex("by_target_code", (q) =>
          q.eq("targetCode", entry.targetCode)
        )
        .first();
      if (existing) {
        const existingTranslations = existing.translations ?? {};
        await ctx.db.patch(existing._id, {
          translations: { ...existingTranslations, [lang]: translation },
        });
      } else {
        await ctx.db.insert("words", {
          ...base,
          translations: { [lang]: translation },
        });
      }
    }
  },
});

