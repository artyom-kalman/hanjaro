import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

const langValidator = v.union(v.literal("en"), v.literal("ru"));

export const getByTelegramUserId = internalQuery({
	args: { telegramUserId: v.number() },
	handler: async (ctx, { telegramUserId }) => {
		return await ctx.db
			.query("userSettings")
			.withIndex("by_telegram_user_id", (q) =>
				q.eq("telegramUserId", telegramUserId),
			)
			.first();
	},
});

export const setLang = internalMutation({
	args: { telegramUserId: v.number(), lang: langValidator },
	handler: async (ctx, { telegramUserId, lang }) => {
		const existing = await ctx.db
			.query("userSettings")
			.withIndex("by_telegram_user_id", (q) =>
				q.eq("telegramUserId", telegramUserId),
			)
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, { lang });
		} else {
			await ctx.db.insert("userSettings", { telegramUserId, lang });
		}
	},
});
