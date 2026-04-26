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

