import { Bot, InlineKeyboard, webhookCallback, type Context } from "grammy";
import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  searchWord,
  type KrdictSearchResult,
} from "./krdict.js";

type Lang = "en" | "ru";

type Translation = { transWord: string; transDfn: string };

type DisplayResult = {
  word: string;
  origin: string;
  targetCode: number;
  pos: string;
  definition: string;
  translations?: {
    en?: Translation;
    ru?: Translation;
  };
};

const LANG_FLAG: Record<Lang, string> = { en: "🇬🇧", ru: "🇷🇺" };

function pickTranslation(
  r: DisplayResult,
  lang: Lang
): { lang: Lang; translation: Translation } | null {
  const t = r.translations;
  if (!t) return null;
  if (t[lang]) return { lang, translation: t[lang]! };
  const other: Lang = lang === "en" ? "ru" : "en";
  if (t[other]) return { lang: other, translation: t[other]! };
  return null;
}

type LoadingMsg = { chat: { id: number }; message_id: number } | null;

function findExactMatches<T extends { word: string }>(
  results: T[],
  query: string
): { exact: T[]; suggestions: T[] } {
  const exact = results.filter((r) => r.word === query);
  const suggestions = exact.length === 0 ? results.slice(0, 5) : [];
  return { exact, suggestions };
}

function hanjaOnly(origin: string): string[] {
  return [...origin].filter(c => c >= '\u4E00' && c <= '\u9FFF');
}

function isHangul(c: string): boolean {
  return c >= "\uAC00" && c <= "\uD7AF";
}

function isHanja(c: string): boolean {
  return c >= "\u4E00" && c <= "\u9FFF";
}

function allHanja(s: string): boolean {
  const chars = [...s];
  return chars.length > 0 && chars.every(isHanja);
}

const USAGE_TEXT =
  "Send me a Korean word and I'll look it up in the dictionary.\n\n" +
  "Examples:\n" +
  "• 학생 — Korean word\n" +
  "• 장 — single syllable (I'll ask what you want)\n" +
  "• 學 — Hanja character";

const HANGUL_PAGE_SIZE = 8;

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

async function sendOrEdit(
  ctx: { reply: (text: string, opts?: object) => Promise<unknown>; api: Bot["api"] },
  loadingMsg: LoadingMsg,
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

type HanjaMeaning = {
  text: string;
  source: "unihan" | "override";
};

type HanjaDoc = {
  character: string;
  meanings: HanjaMeaning[];
  hangul?: string;
  korean?: string;
  mandarin?: string;
} | null;

function formatSearchResult(r: DisplayResult, lang: Lang): string {
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

  const picked = pickTranslation(r, lang);
  if (picked && picked.translation.transWord) {
    lines.push("");
    lines.push(
      `${LANG_FLAG[picked.lang]} ${escapeHtml(picked.translation.transWord)}`
    );
  }
  const transDfn = picked?.translation.transDfn ?? "";
  if (r.definition || transDfn) lines.push("");
  if (r.definition) lines.push(`<i>${escapeHtml(r.definition)}</i>`);
  if (transDfn) lines.push(`<i>${escapeHtml(transDfn)}</i>`);

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

    if (!doc || doc.meanings.length === 0) {
      lines.push(`<b>${escapeHtml(char)}</b> — <i>no data</i>`);
      continue;
    }

    lines.push(`<b>${escapeHtml(doc.character)}</b>`);
    for (const m of doc.meanings) {
      lines.push(` · <i>${escapeHtml(m.text)}</i>`);
    }
    const readings: string[] = [];
    if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
    if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
    if (readings.length > 0) lines.push(readings.join("  "));
  }

  return lines.join("\n");
}

function formatHangulHanjaPage(
  syllable: string,
  pageDocs: NonNullable<HanjaDoc>[],
  page: number,
  totalPages: number,
  total: number,
): string {
  const lines: string[] = [];
  const header = totalPages > 1
    ? `Hanja for <b>${escapeHtml(syllable)}</b>  ·  ${total} total  ·  page ${page + 1}/${totalPages}`
    : `Hanja for <b>${escapeHtml(syllable)}</b>  ·  ${total} total`;
  lines.push(header);

  for (const doc of pageDocs) {
    lines.push("");
    const meaningText = doc.meanings.map((m) => m.text).join(", ");
    const meaningPart = meaningText ? `  ·  <i>${escapeHtml(meaningText)}</i>` : "";
    lines.push(`<b>${escapeHtml(doc.character)}</b>${meaningPart}`);
    const readings: string[] = [];
    if (doc.hangul) readings.push(`🇰🇷 ${escapeHtml(doc.hangul)}`);
    if (doc.mandarin) readings.push(`🇨🇳 ${escapeHtml(doc.mandarin)}`);
    if (readings.length > 0) lines.push(readings.join("  "));
  }

  return lines.join("\n");
}

function buildHangulHanjaKeyboard(
  syllable: string,
  page: number,
  totalPages: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 0) keyboard.text("‹ Prev", `hp:${syllable}:${page - 1}`);
    if (page < totalPages - 1) keyboard.text("Next ›", `hp:${syllable}:${page + 1}`);
  }
  return keyboard;
}

function buildSyllableChoiceKeyboard(syllable: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Look up word", `wq:${syllable}`)
    .text(`Hanja for ${syllable}`, `hh:${syllable}:0`);
}

function buildMeaningKeyboard(
  matches: DisplayResult[],
  lang: Lang
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const m of matches) {
    const origin = m.origin || "—";
    const picked = pickTranslation(m, lang);
    const meaning = picked?.translation.transWord || m.definition || "";
    let label = meaning ? `${origin} · ${meaning}` : origin;
    if (label.length > 60) label = label.slice(0, 59) + "…";
    keyboard.text(label, `m:${m.targetCode}`).row();
  }
  return keyboard;
}

function buildSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇬🇧 English", "lang:en")
    .text("🇷🇺 Русский", "lang:ru");
}

const SETTINGS_TEXT =
  "Choose language / Выберите язык:";

const LANG_CONFIRM: Record<Lang, string> = {
  en: "Language set to English",
  ru: "Язык: Русский",
};

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

  async function lookupHanjaByHangul(syllable: string): Promise<NonNullable<HanjaDoc>[]> {
    return actionCtx.runQuery(internal.hanja.getByHangul, { hangul: syllable });
  }

  async function getUserLang(userId: number | undefined): Promise<Lang> {
    if (userId === undefined) return "en";
    const settings = await actionCtx.runQuery(
      internal.userSettings.getByTelegramUserId,
      { telegramUserId: userId }
    );
    return (settings?.lang as Lang | undefined) ?? "en";
  }

  async function getCached(word: string): Promise<DisplayResult[]> {
    return actionCtx.runQuery(internal.words.getAllByWord, { word });
  }

  function krdictToDisplay(r: KrdictSearchResult, lang: Lang): DisplayResult {
    return {
      word: r.word,
      origin: r.origin,
      targetCode: r.targetCode,
      pos: r.pos,
      definition: r.definition,
      translations: {
        [lang]: { transWord: r.transWord, transDfn: r.transDfn },
      },
    };
  }

  async function searchFromApi(
    word: string,
    lang: Lang
  ): Promise<DisplayResult[]> {
    const results = await searchWord(apiKey, word, lang);
    const { exact } = findExactMatches(results, word);
    if (exact.length > 0) {
      await actionCtx.runMutation(internal.words.saveMany, {
        entries: exact,
        lang,
      });
    }
    return results.map((r) => krdictToDisplay(r, lang));
  }

  function cachedHasLang(docs: DisplayResult[], lang: Lang): boolean {
    return docs.some((d) => d.translations?.[lang] !== undefined);
  }

  async function resolveWord(
    word: string,
    sendLoading: () => Promise<NonNullable<LoadingMsg>>,
    api: Bot["api"],
    lang: Lang,
  ): Promise<{ results: DisplayResult[]; loadingMsg: LoadingMsg }> {
    const cached = await getCached(word);
    if (cached.length > 0 && cachedHasLang(cached, lang)) {
      return { results: cached, loadingMsg: null };
    }

    const loadingMsg = await sendLoading();
    const spinner = startSpinner(api, loadingMsg.chat.id, loadingMsg.message_id);
    try {
      const apiResults = await searchFromApi(word, lang);
      // Prefer refreshed cache (merged translations) for exact matches
      const refreshed = await getCached(word);
      const { exact: refreshedExact } = findExactMatches(refreshed, word);
      if (refreshedExact.length > 0) {
        return { results: refreshed, loadingMsg };
      }
      return { results: apiResults, loadingMsg };
    } finally {
      spinner.stop();
    }
  }

  async function formatResultWithHanja(
    result: DisplayResult,
    lang: Lang
  ): Promise<string> {
    let message = formatSearchResult(result, lang);
    const chars = result.origin ? hanjaOnly(result.origin) : [];
    if (chars.length > 0) {
      const docs = await lookupHanja(chars.join(''));
      message += "\n" + formatHanjaBreakdown(docs, chars);
    }
    return message;
  }

  async function handleWordLookup(
    ctx: Context,
    word: string,
    sendLoading: () => Promise<NonNullable<LoadingMsg>>,
    lang: Lang,
  ): Promise<void> {
    const { results, loadingMsg } = await resolveWord(
      word,
      sendLoading,
      ctx.api,
      lang,
    );

    if (results.length === 0) {
      await sendOrEdit(ctx, loadingMsg, `No results found for <b>${escapeHtml(word)}</b>.`, { parse_mode: "HTML" });
      return;
    }

    const { exact, suggestions } = findExactMatches(results, word);

    if (exact.length === 0) {
      const keyboard = new InlineKeyboard();
      for (const s of suggestions) keyboard.text(s.word, `s:${s.word}`).row();
      await sendOrEdit(ctx, loadingMsg, `No exact match for <b>${escapeHtml(word)}</b>.\nDid you mean:`, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    if (exact.length === 1) {
      const message = await formatResultWithHanja(exact[0]!, lang);
      await sendOrEdit(ctx, loadingMsg, message, { parse_mode: "HTML" });
      return;
    }

    const text = `Multiple meanings for <b>${escapeHtml(word)}</b>:`;
    await sendOrEdit(ctx, loadingMsg, text, {
      parse_mode: "HTML",
      reply_markup: buildMeaningKeyboard(exact, lang),
    });
  }

  async function runWordLookup(
    ctx: Context,
    word: string,
    lang: Lang,
  ): Promise<void> {
    await handleWordLookup(
      ctx,
      word,
      async () => {
        await ctx.replyWithChatAction("typing");
        return ctx.reply(LOADING_FRAMES[0]);
      },
      lang,
    );
  }

  async function handleSingleHanja(ctx: Context, char: string): Promise<void> {
    const docs = await lookupHanja(char);
    const doc = docs[0];
    if (!doc) {
      await ctx.reply(`No Hanja entry for ${escapeHtml(char)}.`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(formatHanjaBreakdown([doc], [char]).trimStart(), { parse_mode: "HTML" });
  }

  async function handleHangulHanjaList(
    ctx: Context,
    syllable: string,
    page: number,
    edit: boolean,
  ): Promise<void> {
    const docs = await lookupHanjaByHangul(syllable);
    if (docs.length === 0) {
      const text = `No Hanja found for ${escapeHtml(syllable)}.`;
      if (edit) await ctx.editMessageText(text, { parse_mode: "HTML" });
      else await ctx.reply(text, { parse_mode: "HTML" });
      return;
    }
    const totalPages = Math.ceil(docs.length / HANGUL_PAGE_SIZE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * HANGUL_PAGE_SIZE;
    const pageDocs = docs.slice(start, start + HANGUL_PAGE_SIZE);
    const text = formatHangulHanjaPage(syllable, pageDocs, safePage, totalPages, docs.length);
    const keyboard = buildHangulHanjaKeyboard(syllable, safePage, totalPages);
    const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };
    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
  }

  bot.command("start", async (ctx) => {
    await ctx.reply(USAGE_TEXT);
  });

  bot.command("settings", async (ctx) => {
    await ctx.reply(SETTINGS_TEXT, { reply_markup: buildSettingsKeyboard() });
  });

  // --- Message handler ---
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const chars = [...text];
    const lang = await getUserLang(ctx.from?.id);

    try {
      // Rule 2: single CJK char
      if (chars.length === 1 && isHanja(chars[0]!)) {
        await handleSingleHanja(ctx, chars[0]!);
        return;
      }
      // Rule 3: multiple CJK chars
      if (chars.length >= 2 && allHanja(text)) {
        await ctx.reply("Please send one Hanja character at a time.");
        return;
      }
      // Rule 4: single Hangul syllable
      if (chars.length === 1 && isHangul(chars[0]!)) {
        const syllable = chars[0]!;
        await ctx.reply(
          `<b>${escapeHtml(syllable)}</b> can mean a Korean word or share its reading with several Hanja.\nWhat do you want?`,
          { parse_mode: "HTML", reply_markup: buildSyllableChoiceKeyboard(syllable) },
        );
        return;
      }
      // Rule 5: multi-syllable Hangul (existing flow)
      const match = text.match(/[\uAC00-\uD7AF]{2,}/);
      if (match) {
        await handleWordLookup(ctx, match[0], () => ctx.reply(LOADING_FRAMES[0]), lang);
        return;
      }
      // Rule 6: fallback
      await ctx.reply(USAGE_TEXT);
    } catch (err) {
      console.error("Message error:", err);
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const lang = await getUserLang(ctx.from?.id);

    try {
      if (data.startsWith("s:")) {
        await runWordLookup(ctx, data.slice(2), lang);
      } else if (data.startsWith("wq:")) {
        await runWordLookup(ctx, data.slice(3), lang);
      } else if (data.startsWith("hh:") || data.startsWith("hp:")) {
        const rest = data.slice(3);
        const idx = rest.lastIndexOf(":");
        const syllable = rest.slice(0, idx);
        const page = Number(rest.slice(idx + 1)) || 0;
        await handleHangulHanjaList(ctx, syllable, page, /*edit*/ true);
      } else if (data.startsWith("m:")) {
        const tc = Number(data.slice(2));
        const doc = await actionCtx.runQuery(internal.words.getByTargetCode, { targetCode: tc });
        if (!doc) {
          await ctx.reply("Meaning no longer cached, please search again.");
        } else {
          const message = await formatResultWithHanja(doc, lang);
          await ctx.reply(message, { parse_mode: "HTML" });
        }
      } else if (data === "lang:en" || data === "lang:ru") {
        const newLang: Lang = data === "lang:en" ? "en" : "ru";
        const userId = ctx.from?.id;
        if (userId !== undefined) {
          await actionCtx.runMutation(internal.userSettings.setLang, {
            telegramUserId: userId,
            lang: newLang,
          });
        }
        await ctx.editMessageText(LANG_CONFIRM[newLang]);
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
