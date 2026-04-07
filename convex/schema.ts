import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hanja: defineTable({
    character: v.string(),
    definition: v.string(),
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
    transWord: v.string(),
    transDfn: v.string(),
  })
    .index("by_word", ["word"])
    .index("by_target_code", ["targetCode"]),
});
