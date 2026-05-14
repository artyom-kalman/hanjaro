import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server.js";
import { internal } from "./_generated/api.js";

export const seedBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        character: v.string(),
        meanings: v.array(
          v.object({
            text: v.string(),
            source: v.union(v.literal("unihan"), v.literal("override")),
          })
        ),
        hangul: v.optional(v.string()),
        korean: v.optional(v.string()),
        mandarin: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { entries }) => {
    for (const entry of entries) {
      const existing = await ctx.db
        .query("hanja")
        .withIndex("by_character", (q) => q.eq("character", entry.character))
        .first();
      if (!existing) {
        await ctx.db.insert("hanja", entry);
      }
    }
  },
});

export const clearBatch = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const docs = await ctx.db.query("hanja").take(limit);
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
    return docs.length;
  },
});

export const clearAll = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    let total = 0;
    const limit = 1000;
    for (let i = 0; i < 50; i++) {
      const deleted: number = await ctx.runMutation(internal.hanja.clearBatch, { limit });
      total += deleted;
      if (deleted < limit) break;
    }
    return total;
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

export const getByHangul = internalQuery({
  args: { hangul: v.string() },
  handler: async (ctx, { hangul }) => {
    return await ctx.db
      .query("hanja")
      .withIndex("by_hangul", (q) => q.eq("hangul", hangul))
      .collect();
  },
});

export const saveTranslations = internalMutation({
  args: {
    lang: v.literal("ru"),
    entries: v.array(
      v.object({
        id: v.id("hanja"),
        meanings: v.array(v.object({ text: v.string() })),
      })
    ),
  },
  handler: async (ctx, { lang, entries }) => {
    for (const entry of entries) {
      if (entry.meanings.length === 0) continue;
      const doc = await ctx.db.get(entry.id);
      if (!doc) continue;
      const translations = { ...(doc.translations ?? {}), [lang]: entry.meanings };
      await ctx.db.patch(entry.id, { translations });
    }
  },
});
