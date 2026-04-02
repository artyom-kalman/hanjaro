import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

export const seedBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        character: v.string(),
        definition: v.string(),
        hangul: v.optional(v.string()),
        korean: v.optional(v.string()),
        mandarin: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { entries }) => {
    for (const entry of entries) {
      await ctx.db.insert("hanja", entry);
    }
  },
});

export const getByCharacters = internalQuery({
  args: { characters: v.array(v.string()) },
  handler: async (ctx, { characters }) => {
    const results = [];
    for (const char of characters) {
      const doc = await ctx.db
        .query("hanja")
        .withIndex("by_character", (q) => q.eq("character", char))
        .first();
      results.push(doc);
    }
    return results;
  },
});
