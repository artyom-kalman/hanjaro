import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hanja: defineTable({
    character: v.string(),
    definition: v.string(),
    hangul: v.optional(v.string()),
    korean: v.optional(v.string()),
    mandarin: v.optional(v.string()),
  }).index("by_character", ["character"]),
});
