import { Bot, webhookCallback } from "grammy";
import { httpAction } from "./_generated/server.js";

export const handleTelegramWebhook = httpAction(async (_, request) => {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN!;
  const bot = new Bot(telegramBotToken);

  bot.on("message", (ctx) => {
    ctx.reply("hi");
  });

  const handleUpdate = webhookCallback(bot, "std/http");
  return await handleUpdate(request);
});
