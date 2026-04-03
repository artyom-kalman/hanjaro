import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

export const getByWord = internalQuery({
  args: { word: v.string() },
  handler: async (ctx, { word }) => {
    return await ctx.db
      .query("words")
      .withIndex("by_word", (q) => q.eq("word", word))
      .first();
  },
});

export const save = internalMutation({
  args: {
    word: v.string(),
    origin: v.string(),
    targetCode: v.number(),
    pos: v.string(),
    definition: v.string(),
    transWord: v.string(),
    transDfn: v.string(),
  },
  handler: async (ctx, entry) => {
    const existing = await ctx.db
      .query("words")
      .withIndex("by_word", (q) => q.eq("word", entry.word))
      .first();
    if (!existing) {
      await ctx.db.insert("words", entry);
    }
  },
});
