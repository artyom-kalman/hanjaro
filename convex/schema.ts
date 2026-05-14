import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hanja: defineTable({
    character: v.string(),
    meanings: v.array(
      v.object({
        text: v.string(),
        source: v.union(v.literal("unihan"), v.literal("override")),
      })
    ),
    translations: v.optional(
      v.object({
        ru: v.optional(v.array(v.object({ text: v.string() }))),
      })
    ),
    hangul: v.optional(v.string()),
    korean: v.optional(v.string()),
    mandarin: v.optional(v.string()),
  })
    .index("by_character", ["character"])
    .index("by_hangul", ["hangul"]),

  words: defineTable({
    word: v.string(),
    origin: v.string(),
    targetCode: v.number(),
    pos: v.string(),
    definition: v.string(),
    translations: v.object({
      en: v.optional(
        v.object({ transWord: v.string(), transDfn: v.string() })
      ),
      ru: v.optional(
        v.object({ transWord: v.string(), transDfn: v.string() })
      ),
    }),
  })
    .index("by_word", ["word"])
    .index("by_target_code", ["targetCode"]),

  userSettings: defineTable({
    telegramUserId: v.number(),
    lang: v.union(v.literal("en"), v.literal("ru")),
  }).index("by_telegram_user_id", ["telegramUserId"]),
});
