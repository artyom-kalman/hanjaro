import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  searchWord,
  viewEntry,
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

function formatCharBreakdown(hanjaChars: HanjaDoc[]): string | null {
  const parts = hanjaChars
    .filter((doc): doc is NonNullable<HanjaDoc> => doc !== null)
    .map((doc) => {
      const segments = [doc.character];
      if (doc.hangul) segments.push(doc.hangul);
      if (doc.mandarin) segments.push(doc.mandarin);
      segments.push(doc.definition);
      return segments.join(" ");
    });
  if (parts.length === 0) return null;
  return `   ${parts.join(" · ")}`;
}

function formatSearchResult(
  r: {
    word: string;
    origin: string;
    pos: string;
    definition: string;
    transWord: string;
    transDfn: string;
  },
  hanjaChars?: HanjaDoc[]
): string {
  const lines: string[] = [];
  const originPart = r.origin ? ` [${escapeHtml(r.origin)}]` : "";
  lines.push(`📖 <b>${escapeHtml(r.word)}</b>${originPart}`);
  if (hanjaChars) {
    const breakdown = formatCharBreakdown(hanjaChars);
    if (breakdown) lines.push(breakdown);
  }
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
  if (r.definition) lines.push(escapeHtml(r.definition));
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
  lines.push(`📖 <b>${escapeHtml(wordLabel)}</b>${originPart}`);

  if (view.pronunciation)
    lines.push(`🔊 ${escapeHtml(view.pronunciation)}`);
  if (view.grade) lines.push(`📊 ${escapeHtml(view.grade)}`);
  lines.push("");

  for (let i = 0; i < view.senses.length; i++) {
    const s = view.senses[i];
    lines.push(`<b>${i + 1}.</b> ${escapeHtml(s.definition)}`);
    if (s.transWord) lines.push(`   🇬🇧 ${escapeHtml(s.transWord)}`);
    if (s.transDfn) lines.push(`   ${escapeHtml(s.transDfn)}`);
    for (const rel of s.relatedWords) {
      lines.push(`   🔗 ${escapeHtml(rel.word)} (${escapeHtml(rel.type)})`);
    }
  }

  if (view.derivedWords.length > 0) {
    lines.push("");
    lines.push(
      `📝 <b>Derived:</b> ${view.derivedWords.map((d) => escapeHtml(d.word)).join(", ")}`
    );
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

      const { exact, suggestions } = findExactMatch(results, word);

      if (!exact) {
        const keyboard = new InlineKeyboard();
        for (const s of suggestions) {
          keyboard.text(s.word, `s:${s.word}`).row();
        }
        await ctx.reply(
          `No exact match for <b>${escapeHtml(word)}</b>.\nDid you mean:`,
          { parse_mode: "HTML", reply_markup: keyboard }
        );
        return;
      }

      const hanjaChars = await lookupHanja(exact.origin);
      const message = formatSearchResult(exact, hanjaChars);
      const origin = exact.origin;

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
      } else if (data.startsWith("s:")) {
        const word = data.slice(2);
        const results = await searchWord(apiKey, word);
        const { exact } = findExactMatch(results, word);
        if (!exact) {
          await ctx.reply(
            `No results for <b>${escapeHtml(word)}</b>.`,
            { parse_mode: "HTML" }
          );
        } else {
          const hanjaChars = await lookupHanja(exact.origin);
          const message = formatSearchResult(exact, hanjaChars);
          const origin = exact.origin;
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
        }
      } else if (data.startsWith("ha:")) {
        const chars = [...data.slice(3)];
        const details = await Promise.all(
          chars.map((char) => formatDetailedView(apiKey, char))
        );
        for (const detail of details) {
          await ctx.reply(detail, { parse_mode: "HTML" });
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
