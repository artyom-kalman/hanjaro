import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

const wordEntry = {
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
  args: { entries: v.array(v.object(wordEntry)) },
  handler: async (ctx, { entries }) => {
    for (const entry of entries) {
      const existing = await ctx.db
        .query("words")
        .withIndex("by_target_code", (q) => q.eq("targetCode", entry.targetCode))
        .first();
      if (!existing) {
        await ctx.db.insert("words", entry);
      }
    }
  },
});
