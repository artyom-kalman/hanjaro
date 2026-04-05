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

type LoadingMsg = { chat: { id: number }; message_id: number };

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

async function sendOrEdit(
  ctx: { reply: (text: string, opts?: object) => Promise<unknown>; api: Bot["api"] },
  loadingMsg: LoadingMsg | null,
  text: string,
  opts?: Record<string, unknown>,
): Promise<void> {
  if (loadingMsg) {
    await ctx.api.editMessageText(loadingMsg.chat.id, loadingMsg.message_id, text, opts);
  } else {
    await ctx.reply(text, opts);
  }
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

function formatHanjaBreakdown(
  docs: HanjaDoc[],
  chars: string[],
): string {
  const lines: string[] = [];

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

  async function resolveWord(
    word: string,
    sendLoading: () => Promise<LoadingMsg>,
    api: Bot["api"],
  ): Promise<{ results: KrdictSearchResult[]; loadingMsg: LoadingMsg | null }> {
    const cached = await getCached(word);
    if (cached) return { results: [cached], loadingMsg: null };

    const loadingMsg = await sendLoading();
    const spinner = startSpinner(api, loadingMsg.chat.id, loadingMsg.message_id);
    try {
      const results = await searchFromApi(word);
      return { results, loadingMsg };
    } finally {
      spinner.stop();
    }
  }

  async function formatResultWithHanja(exact: KrdictSearchResult): Promise<string> {
    let message = formatSearchResult(exact);
    const chars = exact.origin ? hanjaOnly(exact.origin) : [];
    if (chars.length > 0) {
      const docs = await lookupHanja(chars.join(''));
      message += "\n" + formatHanjaBreakdown(docs, chars);
    }
    return message;
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
      const { results, loadingMsg } = await resolveWord(
        word,
        () => ctx.reply(LOADING_FRAMES[0]),
        ctx.api,
      );

      if (results.length === 0) {
        await sendOrEdit(ctx, loadingMsg, `No results found for <b>${escapeHtml(word)}</b>.`, { parse_mode: "HTML" });
        return;
      }

      const { exact, suggestions } = findExactMatch(results, word);

      if (!exact) {
        const keyboard = new InlineKeyboard();
        for (const s of suggestions) keyboard.text(s.word, `s:${s.word}`).row();
        await sendOrEdit(ctx, loadingMsg, `No exact match for <b>${escapeHtml(word)}</b>.\nDid you mean:`, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }

      const message = await formatResultWithHanja(exact);
      await sendOrEdit(ctx, loadingMsg, message, { parse_mode: "HTML" });
    } catch (err) {
      console.error("Search error:", err);
      await ctx.reply("Sorry, dictionary lookup failed. Please try again.");
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    try {
      if (data.startsWith("s:")) {
        const word = data.slice(2);
        const { results, loadingMsg } = await resolveWord(
          word,
          async () => {
            await ctx.replyWithChatAction("typing");
            return ctx.reply(LOADING_FRAMES[0]);
          },
          ctx.api,
        );

        const { exact } = findExactMatch(results, word);
        if (!exact) {
          await sendOrEdit(ctx, loadingMsg, `No results for <b>${escapeHtml(word)}</b>.`, { parse_mode: "HTML" });
        } else {
          const message = await formatResultWithHanja(exact);
          await sendOrEdit(ctx, loadingMsg, message, { parse_mode: "HTML" });
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
