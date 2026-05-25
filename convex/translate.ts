import { v } from "convex/values";
import OpenAI from "openai";
import { Bot } from "grammy";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { formatHanjaBreakdown } from "./hanjaFormat.js";
import { t } from "./i18n.js";

// OpenRouter is OpenAI-API-compatible — pointing baseURL at it lets us reuse
// the openai SDK without adding a dep. Default model is Google Gemini 3.1
// Flash Lite (paid, ~$0.25/$1.50 per 1M tok, ~0.84s latency, JSON mode
// supported). Override via OPENROUTER_MODEL when experimenting.
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const TIMEOUT_MS = 5000;

type CharInput = {
  id: Id<"hanja">;
  character: string;
  hangul?: string;
  mandarin?: string;
  englishMeanings: string[];
};

type ExampleWord = { word: string; transWord: string };

const EXAMPLES_PER_CHAR = 3;

function buildPrompt(
  chars: CharInput[],
  examplesByChar: Map<string, ExampleWord[]>,
): string {
  const lines: string[] = [
    "Translate Korean Hanja (Chinese character) glosses from English to Russian.",
    "For each character, translate each English meaning into a single concise Russian word",
    "or short phrase, dictionary-style. Keep the same number of glosses per character.",
    "When example words are provided, use them to ground the meaning — the Russian gloss",
    "should be consistent with how the character is used in those words.",
    "",
    "Characters:",
  ];
  for (const c of chars) {
    const ctx: string[] = [];
    if (c.hangul) ctx.push(`Korean: ${c.hangul}`);
    if (c.mandarin) ctx.push(`Pinyin: ${c.mandarin}`);
    const ctxPart = ctx.length > 0 ? ` (${ctx.join(", ")})` : "";
    lines.push(`- ${c.character}${ctxPart}: ${c.englishMeanings.join(", ")}`);
    const examples = examplesByChar.get(c.character) ?? [];
    if (examples.length > 0) {
      const exStr = examples
        .map((e) => `${e.word} = ${e.transWord}`)
        .join(", ");
      lines.push(`  Example words: ${exStr}`);
    }
  }
  lines.push("");
  lines.push("Return strict JSON only, no preamble. Keys are the characters above,");
  lines.push("values are arrays of Russian glosses. Example shape:");
  lines.push('{"正":["правильный","надлежащий","верный"]}');
  return lines.join("\n");
}

function parseResponse(
  raw: string,
  chars: CharInput[],
): Map<string, string[]> {
  const trimmed = raw.trim();
  // Some models wrap JSON in ```json fences; strip them.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  const result = new Map<string, string[]>();
  for (const c of chars) {
    const value = parsed[c.character];
    if (!Array.isArray(value)) continue;
    const glosses = value
      .filter((g): g is string => typeof g === "string")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    if (glosses.length > 0) result.set(c.character, glosses);
  }
  return result;
}

export const translateHanjaToRu = internalAction({
  args: {
    docs: v.array(
      v.object({
        id: v.id("hanja"),
        character: v.string(),
        hangul: v.optional(v.string()),
        mandarin: v.optional(v.string()),
        englishMeanings: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, { docs }): Promise<{ translatedCount: number }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error("translate: OPENROUTER_API_KEY not set");
      return { translatedCount: 0 };
    }
    const targets: CharInput[] = docs.filter(
      (d) => d.englishMeanings.length > 0
    );
    if (targets.length === 0) return { translatedCount: 0 };

    const examplesList = await ctx.runQuery(
      internal.words.getExamplesForCharacters,
      {
        characters: targets.map((t) => t.character),
        lang: "ru",
        limit: EXAMPLES_PER_CHAR,
      },
    );
    const examplesByChar = new Map<string, ExampleWord[]>();
    for (const e of examplesList) {
      examplesByChar.set(e.character, e.examples);
    }

    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
    const client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let raw: string;
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "user", content: buildPrompt(targets, examplesByChar) },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        },
        { signal: controller.signal }
      );
      const choices = completion?.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        console.error(
          "translate: unexpected response shape",
          JSON.stringify(completion)
        );
        return { translatedCount: 0 };
      }
      const message = choices[0]?.message as
        | {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
          }
        | undefined;
      // Some OpenRouter-hosted models occasionally route the answer into
      // `reasoning` instead of `content`. Try the standard field first, then
      // known alternates. Empty string from any of them is treated as "no answer".
      raw =
        (message?.content && message.content.trim()) ||
        (message?.reasoning && message.reasoning.trim()) ||
        (message?.reasoning_content && message.reasoning_content.trim()) ||
        "";
      if (!raw) {
        console.error(
          "translate: empty content; full message =",
          JSON.stringify(message)
        );
      }
    } catch (err) {
      console.error("translate: OpenRouter call failed", err);
      return { translatedCount: 0 };
    } finally {
      clearTimeout(timer);
    }

    if (!raw) return { translatedCount: 0 };

    let parsed: Map<string, string[]>;
    try {
      parsed = parseResponse(raw, targets);
    } catch (err) {
      console.error("translate: malformed JSON from model", err, raw);
      return { translatedCount: 0 };
    }

    const entries = targets
      .map((d) => {
        const glosses = parsed.get(d.character);
        if (!glosses) return null;
        return { id: d.id, meanings: glosses.map((text) => ({ text })) };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (entries.length === 0) return { translatedCount: 0 };

    await ctx.runMutation(internal.hanja.saveTranslations, {
      lang: "ru",
      entries,
    });

    return { translatedCount: entries.length };
  },
});

// Background job dispatched by the webhook handler. Does the slow OpenRouter
// call + DB persist on its own time, then edits the original result message
// in place — so the webhook stays inside grammy's 10s timeout and the user
// sees a single message that upgrades from EN to RU when ready.
export const scheduledTranslateAndEdit = internalAction({
  args: {
    chatId: v.number(),
    messageId: v.number(),
    prefix: v.string(),
    chars: v.array(v.string()),
    docs: v.array(
      v.object({
        id: v.id("hanja"),
        character: v.string(),
        hangul: v.optional(v.string()),
        mandarin: v.optional(v.string()),
        englishMeanings: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, { chatId, messageId, prefix, chars, docs }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("scheduledTranslateAndEdit: TELEGRAM_BOT_TOKEN not set");
      return;
    }
    const bot = new Bot(token);
    const ui = t("ru");

    let translatedCount = 0;
    try {
      const result = await ctx.runAction(
        internal.translate.translateHanjaToRu,
        { docs },
      );
      translatedCount = result.translatedCount;
    } catch (err) {
      console.error("scheduledTranslateAndEdit: translation failed", err);
    }

    // Re-query so the rendered breakdown reflects whatever made it into the
    // cache. On failure (translatedCount === 0), pickHanjaMeanings falls back
    // to English glosses — same content the user already sees, so we just
    // append the failure note.
    const refreshed = await ctx.runQuery(
      internal.hanja.getByCharacters,
      { characters: chars },
    );
    const breakdown = formatHanjaBreakdown(refreshed, chars, "ru");
    const body = translatedCount === 0
      ? `${prefix}\n${breakdown}\n\n${ui.hanjaTranslateFailed}`
      : `${prefix}\n${breakdown}`;

    try {
      await bot.api.editMessageText(chatId, messageId, body, {
        parse_mode: "HTML",
      });
    } catch (err) {
      console.error("scheduledTranslateAndEdit: editMessageText failed", err);
    }
  },
});
