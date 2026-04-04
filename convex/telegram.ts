import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  searchWord,
  type KrdictSearchResult,
} from "./krdict.js";

function findExactMatch(
  results: KrdictSearchResult[],
  query: string
): { exact: KrdictSearchResult | null; suggestions: KrdictSearchResult[] } {
  const exact = results.find((r) => r.word === query) ?? null;
  const suggestions = exact ? [] : results.slice(0, 5);
  return { exact, suggestions };
}

function hanjaOnly(origin: string): string[] {
  return [...origin].filter(c => c >= '\u4E00' && c <= '\u9FFF');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const LOADING_FRAMES = ["Looking up.", "Looking up..", "Looking up...", "Looking up.."];

function startSpinner(api: Bot["api"], chatId: number, messageId: number): { stop: () => void } {
  let i = 0;
  const spinInterval = setInterval(() => {
    i = (i + 1) % LOADING_FRAMES.length;
    api.editMessageText(chatId, messageId, LOADING_FRAMES[i]).catch(() => {});
  }, 700);
  api.sendChatAction(chatId, "typing").catch(() => {});
  const typingInterval = setInterval(() => {
    api.sendChatAction(chatId, "typing").catch(() => {});
  }, 3000);
  return { stop: () => { clearInterval(spinInterval); clearInterval(typingInterval); } };
}

const posMap: Record<string, string> = {
  "명사": "Noun",
  "동사": "Verb",
  "형용사": "Adjective",
  "부사": "Adverb",
  "감탄사": "Interjection",
  "대명사": "Pronoun",
  "수사": "Numeral",
  "관형사": "Determiner",
  "조사": "Particle",
  "접사": "Affix",
  "의존 명사": "Dependent Noun",
  "보조 동사": "Auxiliary Verb",
  "보조 형용사": "Auxiliary Adjective",
};

type HanjaDoc = {
  character: string;
  definition: string;
  hangul?: string;
  korean?: string;
  mandarin?: string;
} | null;

function formatSearchResult(
  r: {
    word: string;
    origin: string;
    pos: string;
    definition: string;
    transWord: string;
    transDfn: string;
  },
): string {
  const lines: string[] = [];
  const originPart = r.origin
    ? `  ·  <code>${escapeHtml(r.origin)}</code>`
    : "";
  lines.push(`📖  <b>${escapeHtml(r.word)}</b>${originPart}`);
  if (r.pos) {
    const eng = posMap[r.pos];
    const posText = eng ? `${escapeHtml(r.pos)} (${eng})` : escapeHtml(r.pos);
    lines.push(`<i>${posText}</i>`);
  }

  if (r.transWord) {
    lines.push("");
    lines.push(`🇬🇧 ${escapeHtml(r.transWord)}`);
  }
  if (r.definition || r.transDfn) lines.push("");
  if (r.definition) lines.push(`<i>${escapeHtml(r.definition)}</i>`);
  if (r.transDfn) lines.push(`<i>${escapeHtml(r.transDfn)}</i>`);

  return lines.join("\n");
}

function formatCharDetailView(doc: HanjaDoc, char: string): string {
  if (!doc) return `<b>${escapeHtml(char)}</b> — <i>no hanja data</i>`;

  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(doc.character)}</b>  ·  <i>${escapeHtml(doc.definition)}</i>`);
  if (doc.hangul) lines.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
  if (doc.mandarin) lines.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
  return lines.join("\n");
}

function formatAllCharactersView(
  origin: string,
  docs: HanjaDoc[],
  chars: string[],
): string {
  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(origin)}</b>  ·  Hanja Breakdown`);

  for (let i = 0; i < chars.length; i++) {
    const doc = docs[i];
    const char = chars[i];
    lines.push("");

    if (!doc) {
      lines.push(`<b>${escapeHtml(char)}</b> — <i>no data</i>`);
      continue;
    }

    lines.push(`<b>${escapeHtml(doc.character)}</b>  ·  <i>${escapeHtml(doc.definition)}</i>`);
    const readings: string[] = [];
    if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
    if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
    if (readings.length > 0) lines.push(readings.join("  "));
  }

  return lines.join("\n");
}

export const handleTelegramWebhook = httpAction(async (actionCtx, request) => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const apiKey = process.env.KRDICT_API_KEY!;
  const bot = new Bot(token);

  async function lookupHanja(origin: string): Promise<HanjaDoc[]> {
    if (!origin) return [];
    return actionCtx.runQuery(internal.hanja.getByCharacters, {
      characters: [...origin],
    });
  }

  async function getCached(word: string): Promise<KrdictSearchResult | null> {
    return actionCtx.runQuery(internal.words.getByWord, { word });
  }

  async function searchFromApi(word: string): Promise<KrdictSearchResult[]> {
    const results = await searchWord(apiKey, word);
    const { exact } = findExactMatch(results, word);
    if (exact) {
      await actionCtx.runMutation(internal.words.save, exact);
    }
    return results;
  }

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
      const cached = await getCached(word);
      let results: KrdictSearchResult[];
      let loadingMsg: { chat: { id: number }; message_id: number } | null = null;

      if (cached) {
        results = [cached];
      } else {
        loadingMsg = await ctx.reply(`${LOADING_FRAMES[0]}`);
        const spinner = startSpinner(ctx.api, loadingMsg.chat.id, loadingMsg.message_id);
        try {
          results = await searchFromApi(word);
        } finally {
          spinner.stop();
        }
      }

      if (results.length === 0) {
        const text = `No results found for <b>${escapeHtml(word)}</b>.`;
        if (loadingMsg) {
          await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, text, { parse_mode: "HTML" });
        } else {
          await ctx.reply(text, { parse_mode: "HTML" });
        }
        return;
      }

      const { exact, suggestions } = findExactMatch(results, word);

      if (!exact) {
        const keyboard = new InlineKeyboard();
        for (const s of suggestions) {
          keyboard.text(s.word, `s:${s.word}`).row();
        }
        const text = `No exact match for <b>${escapeHtml(word)}</b>.\nDid you mean:`;
        if (loadingMsg) {
          await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, text, { parse_mode: "HTML", reply_markup: keyboard });
        } else {
          await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
        }
        return;
      }

      const message = formatSearchResult(exact);
      const origin = exact.origin;

      const chars = origin ? hanjaOnly(origin) : [];
      if (chars.length > 0) {
        const keyboard = new InlineKeyboard();
        for (const char of chars) {
          keyboard.text(char, `h:${char}`);
        }
        if (chars.length > 1) {
          keyboard.row().text("All", `ha:${origin}`);
        }

        if (loadingMsg) {
          await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, message, { parse_mode: "HTML", reply_markup: keyboard });
        } else {
          await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
        }
      } else {
        if (loadingMsg) {
          await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, message, { parse_mode: "HTML" });
        } else {
          await ctx.reply(message, { parse_mode: "HTML" });
        }
      }
    } catch (err) {
      console.error("Search error:", err);
      await ctx.reply("Sorry, dictionary lookup failed. Please try again.");
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    try {
      if (data.startsWith("h:")) {
        const char = data.slice(2);
        const [doc] = await lookupHanja(char);
        const detail = formatCharDetailView(doc, char);
        await ctx.reply(detail, { parse_mode: "HTML" });
      } else if (data.startsWith("s:")) {
        const word = data.slice(2);
        const cached = await getCached(word);
        let results: KrdictSearchResult[];
        let loadingMsg: { chat: { id: number }; message_id: number } | null = null;

        if (cached) {
          results = [cached];
        } else {
          await ctx.replyWithChatAction("typing");
          loadingMsg = await ctx.reply(`${LOADING_FRAMES[0]}`);
          const spinner = startSpinner(ctx.api, loadingMsg.chat.id, loadingMsg.message_id);
          try {
            results = await searchFromApi(word);
          } finally {
            spinner.stop();
          }
        }

        const { exact } = findExactMatch(results, word);
        if (!exact) {
          const text = `No results for <b>${escapeHtml(word)}</b>.`;
          if (loadingMsg) {
            await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, text, { parse_mode: "HTML" });
          } else {
            await ctx.reply(text, { parse_mode: "HTML" });
          }
        } else {
          const message = formatSearchResult(exact);
          const origin = exact.origin;
          const chars = origin ? hanjaOnly(origin) : [];
          if (chars.length > 0) {
            const keyboard = new InlineKeyboard();
            for (const char of chars) {
              keyboard.text(char, `h:${char}`);
            }
            if (chars.length > 1) {
              keyboard.row().text("All", `ha:${origin}`);
            }
            if (loadingMsg) {
              await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, message, { parse_mode: "HTML", reply_markup: keyboard });
            } else {
              await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
            }
          } else {
            if (loadingMsg) {
              await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, message, { parse_mode: "HTML" });
            } else {
              await ctx.reply(message, { parse_mode: "HTML" });
            }
          }
        }
      } else if (data.startsWith("ha:")) {
        const origin = data.slice(3);
        const chars = hanjaOnly(origin);
        const docs = await lookupHanja(chars.join(''));
        const message = formatAllCharactersView(origin, docs, chars);
        await ctx.reply(message, { parse_mode: "HTML" });
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
