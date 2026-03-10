import { Bot } from "grammy";

const telegramBotToken: string = process.env.TELEGRAM_BOT_TOKEN || "";

const bot = new Bot(telegramBotToken);

bot.on("message", (ctx) => ctx.reply("Hi there!"));

bot.start();
