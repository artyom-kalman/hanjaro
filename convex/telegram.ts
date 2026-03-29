import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { httpAction } from "./_generated/server.js";
import { searchWord, viewEntry } from "./krdict.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSearchResult(r: {
  word: string;
  origin: string;
  pos: string;
  definition: string;
  transWord: string;
  transDfn: string;
}): string {
  const lines: string[] = [];
  const originPart = r.origin ? ` [${escapeHtml(r.origin)}]` : "";
  lines.push(`<b>${escapeHtml(r.word)}</b>${originPart}`);
  if (r.pos) lines.push(`<i>${escapeHtml(r.pos)}</i>`);
  lines.push("");
  if (r.definition) lines.push(escapeHtml(r.definition));
  if (r.transWord) lines.push(`<b>EN:</b> ${escapeHtml(r.transWord)}`);
  if (r.transDfn) lines.push(escapeHtml(r.transDfn));
  return lines.join("\n");
}

async function formatDetailedView(
  apiKey: string,
  char: string
): Promise<string> {
  const results = await searchWord(apiKey, char);
  if (results.length === 0) return `<b>${escapeHtml(char)}</b> — no results`;

  const first = results[0];
  const view = await viewEntry(apiKey, first.targetCode);
  if (!view) return `<b>${escapeHtml(char)}</b> — no detailed info`;

  const lines: string[] = [];
  const wordLabel = view.word ?? char;
  const originPart = view.origin ? ` (${escapeHtml(view.origin)})` : "";
  lines.push(`<b>${escapeHtml(wordLabel)}</b>${originPart}`);

  if (view.pronunciation)
    lines.push(`Pronunciation: ${escapeHtml(view.pronunciation)}`);
  if (view.grade) lines.push(`Grade: ${escapeHtml(view.grade)}`);
  lines.push("");

  for (let i = 0; i < view.senses.length; i++) {
    const s = view.senses[i];
    lines.push(`<b>${i + 1}.</b> ${escapeHtml(s.definition)}`);
    if (s.transWord) lines.push(`   EN: ${escapeHtml(s.transWord)}`);
    if (s.transDfn) lines.push(`   ${escapeHtml(s.transDfn)}`);
    for (const rel of s.relatedWords) {
      lines.push(`   → ${escapeHtml(rel.word)} (${escapeHtml(rel.type)})`);
    }
  }

  if (view.derivedWords.length > 0) {
    lines.push("");
    lines.push(
      `<b>Derived:</b> ${view.derivedWords.map((d) => escapeHtml(d.word)).join(", ")}`
    );
  }

  return lines.join("\n");
}

export const handleTelegramWebhook = httpAction(async (_, request) => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const apiKey = process.env.KRDICT_API_KEY!;
  const bot = new Bot(token);

  // --- Message handler ---
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(/[\uAC00-\uD7AF]+/);
    if (!match) {
      await ctx.reply("Send me a Korean word and I'll look it up in the dictionary.");
      return;
    }

    const word = match[0];
    try {
      const results = await searchWord(apiKey, word);
      if (results.length === 0) {
        await ctx.reply(`No results found for <b>${escapeHtml(word)}</b>.`, {
          parse_mode: "HTML",
        });
        return;
      }

      const first = results[0];
      const message = formatSearchResult(first);
      const origin = first.origin;

      if (origin && origin.length > 0) {
        const chars = [...origin];
        const keyboard = new InlineKeyboard();
        for (const char of chars) {
          keyboard.text(char, `h:${char}`);
        }
        keyboard.row().text("All", `ha:${origin}`);

        await ctx.reply(message, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } else {
        await ctx.reply(message, { parse_mode: "HTML" });
      }
    } catch (err) {
      console.error("Search error:", err);
      await ctx.reply("Sorry, dictionary lookup failed. Please try again.");
    }
  });

  // --- Callback query handler ---
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    try {
      if (data.startsWith("h:")) {
        const char = data.slice(2);
        const detail = await formatDetailedView(apiKey, char);
        await ctx.reply(detail, { parse_mode: "HTML" });
      } else if (data.startsWith("ha:")) {
        const chars = [...data.slice(3)];
        const details = await Promise.all(
          chars.map((char) => formatDetailedView(apiKey, char))
        );
        const combined = details.join("\n\n───────────\n\n");

        // Split if too long for Telegram (4096 char limit)
        if (combined.length <= 4096) {
          await ctx.reply(combined, { parse_mode: "HTML" });
        } else {
          for (const detail of details) {
            await ctx.reply(detail, { parse_mode: "HTML" });
          }
        }
      }
    } catch (err) {
      console.error("Callback error:", err);
      await ctx.answerCallbackQuery({
        text: "Lookup failed, please try again.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  const handleUpdate = webhookCallback(bot, "std/http");
  return await handleUpdate(request);
});
