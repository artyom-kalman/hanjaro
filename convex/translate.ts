import { v } from "convex/values";
import OpenAI from "openai";
import { Bot } from "grammy";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  formatWordResult,
  hasMissingRuTranslation,
  type DisplayResult,
} from "./hanjaFormat.js";
import { t } from "./i18n.js";
import {
  buildDefinitionPrompt,
  buildGlossFromDescriptionPrompt,
  buildWordPrompt,
  parseDefinitionResponse,
  parseWordResponse,
} from "./wordPrompt.js";

// OpenRouter is OpenAI-API-compatible — pointing baseURL at it lets us reuse
// the openai SDK without adding a dep. Default model is Google Gemini 3.1
// Flash Lite (paid, ~$0.25/$1.50 per 1M tok, ~0.84s latency, JSON mode
// supported). Override via OPENROUTER_MODEL when experimenting.
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
// Per-attempt request timeout. The OpenAI SDK throws APIConnectionTimeoutError
// when this elapses, which (unlike a manual AbortController signal) is retried
// automatically. With MAX_RETRIES, worst-case latency before we give up is
// roughly (MAX_RETRIES + 1) * TIMEOUT_MS plus exponential backoff. Safe here
// because this runs as a detached scheduled action with no webhook deadline.
const TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;

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

// Single OpenRouter JSON-mode chat completion. Centralizes client setup, the
// timeout/retry config, and content extraction (some OpenRouter-hosted models
// route the answer into `reasoning` instead of `content`). Returns the raw
// response string, or null when the key is missing, the call fails, or the
// model returned nothing usable. Callers parse the JSON themselves.
async function callOpenRouterJson(prompt: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("translate: OPENROUTER_API_KEY not set");
    return null;
  }
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      },
      { timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES }
    );
    const choices = completion?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      console.error(
        "translate: unexpected response shape",
        JSON.stringify(completion)
      );
      return null;
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
    const raw =
      (message?.content && message.content.trim()) ||
      (message?.reasoning && message.reasoning.trim()) ||
      (message?.reasoning_content && message.reasoning_content.trim()) ||
      "";
    if (!raw) {
      console.error(
        "translate: empty content; full message =",
        JSON.stringify(message)
      );
      return null;
    }
    return raw;
  } catch (err) {
    console.error("translate: OpenRouter call failed", err);
    return null;
  }
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

    const raw = await callOpenRouterJson(buildPrompt(targets, examplesByChar));
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

// Word-level AI translation for a single language (en or ru). Branches on
// whether KrDict left a description (Korean definition and/or transDfn):
// case 1 → Prompt A (word + Hanja, gloss + transDfn + Korean definition);
// case 2 → Prompt B (description-grounded gloss only, transDfn pass-through).
// Degrades gracefully: any failure / unusable reply returns { translated: false }.
export const translateWordToLang = internalAction({
  args: {
    targetCode: v.number(),
    lang: v.union(v.literal("en"), v.literal("ru")),
    word: v.string(),
    origin: v.string(),
    pos: v.string(),
    definition: v.string(),
    transDfn: v.string(),
    hanjaContext: v.array(
      v.object({
        character: v.string(),
        englishMeanings: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ translated: boolean }> => {
    const hasDescription = args.definition !== "" || args.transDfn !== "";
    const hanjaContext = args.hanjaContext;

    const prompt = hasDescription
      ? buildGlossFromDescriptionPrompt(
          {
            word: args.word,
            pos: args.pos,
            hanjaContext,
            description: args.definition || args.transDfn,
          },
          args.lang,
        )
      : buildWordPrompt(
          {
            word: args.word,
            pos: args.pos,
            definition: "",
            hanjaContext,
          },
          args.lang,
        );

    const raw = await callOpenRouterJson(prompt);
    if (!raw) return { translated: false };

    const parsed = parseWordResponse(raw);
    if (!parsed) {
      console.error("translateWordToLang: unusable response", raw);
      return { translated: false };
    }

    const saveArgs: {
      targetCode: number;
      lang: "en" | "ru";
      transWord: string;
      transDfn: string;
      definition?: string;
    } = {
      targetCode: args.targetCode,
      lang: args.lang,
      transWord: parsed.transWord,
      transDfn: hasDescription ? args.transDfn : parsed.transDfn,
    };

    if (
      !hasDescription &&
      args.definition === "" &&
      parsed.definition
    ) {
      saveArgs.definition = parsed.definition;
    }

    await ctx.runMutation(internal.words.saveAiWordTranslation, saveArgs);

    return { translated: true };
  },
});

// Generates a Korean definition (Prompt C) for a word that already has a gloss
// but no Korean definition — the missed case where KrDict supplied a gloss but no
// 뜻풀이. Saves the definition only, never touching translations, so a real KrDict
// gloss is not relabeled as AI. Degrades gracefully.
export const translateWordDefinition = internalAction({
  args: {
    targetCode: v.number(),
    lang: v.union(v.literal("en"), v.literal("ru")),
    word: v.string(),
    pos: v.string(),
    meaning: v.string(),
    hanjaContext: v.array(
      v.object({
        character: v.string(),
        englishMeanings: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ translated: boolean }> => {
    const prompt = buildDefinitionPrompt(
      {
        word: args.word,
        pos: args.pos,
        hanjaContext: args.hanjaContext,
        meaning: args.meaning,
      },
      args.lang,
    );

    const raw = await callOpenRouterJson(prompt);
    if (!raw) return { translated: false };

    const parsed = parseDefinitionResponse(raw);
    if (!parsed) {
      console.error("translateWordDefinition: unusable response", raw);
      return { translated: false };
    }

    await ctx.runMutation(internal.words.saveAiDefinition, {
      targetCode: args.targetCode,
      definition: parsed.definition,
    });

    return { translated: true };
  },
});

// Background orchestrator dispatched by the webhook handler. Keyed only by
// targetCode + lang, it re-derives everything (the word, its Hanja chars, the
// Hanja docs), runs the needed independent LLM calls CONCURRENTLY — char-gloss
// translation (RU only) and word-level translation (en or ru) — then re-renders
// the full message and performs exactly ONE editMessageText. Re-deriving here
// (rather than freezing a rendered prefix at schedule time) is what lets a newly
// added word-translation line appear, and the single edit is what keeps the two
// LLM calls from racing on the same message. Runs detached, so it can outlast
// grammy's 10s webhook deadline.
export const scheduledTranslateAndEdit = internalAction({
  args: {
    chatId: v.number(),
    messageId: v.number(),
    targetCode: v.number(),
    lang: v.union(v.literal("en"), v.literal("ru")),
  },
  handler: async (ctx, { chatId, messageId, targetCode, lang }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("scheduledTranslateAndEdit: TELEGRAM_BOT_TOKEN not set");
      return;
    }

    const word = await ctx.runQuery(internal.words.getByTargetCode, {
      targetCode,
    });
    if (!word) {
      console.error("scheduledTranslateAndEdit: word not found", targetCode);
      return;
    }

    const chars = [...word.origin].filter(
      (c) => c >= "\u4E00" && c <= "\u9FFF",
    );
    const hanjaDocs = chars.length > 0
      ? await ctx.runQuery(internal.hanja.getByCharacters, { characters: chars })
      : [];
    const presentHanja = hanjaDocs.filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );

    // Char glosses only ever AI-translate for Russian (English is native
    // Unihan). The word call runs for whichever language KrDict left empty.
    const missingHanja =
      lang === "ru" ? presentHanja.filter(hasMissingRuTranslation) : [];
    const wordNeedsTranslation = !word.translations[lang]?.transWord;
    const existingTransDfn = word.translations[lang]?.transDfn ?? "";
    // Prompt A (case 1: gloss missing AND no description) already emits a Korean
    // definition, so only run the standalone definition call when case 1 won't.
    const case1MakesDefinition =
      wordNeedsTranslation && !word.definition && !existingTransDfn;
    const definitionNeeded = !word.definition && !case1MakesDefinition;
    const attempted =
      missingHanja.length > 0 || wordNeedsTranslation || definitionNeeded;

    const charPromise = missingHanja.length > 0
      ? ctx.runAction(internal.translate.translateHanjaToRu, {
          docs: missingHanja.map((d) => ({
            id: d._id,
            character: d.character,
            hangul: d.hangul,
            mandarin: d.mandarin,
            englishMeanings: d.meanings.map((m) => m.text),
          })),
        })
      : Promise.resolve({ translatedCount: 0 });
    const wordPromise = wordNeedsTranslation
      ? ctx.runAction(internal.translate.translateWordToLang, {
          targetCode,
          lang,
          word: word.word,
          origin: word.origin,
          pos: word.pos,
          definition: word.definition,
          transDfn: existingTransDfn,
          hanjaContext: presentHanja.map((d) => ({
            character: d.character,
            englishMeanings: d.meanings.map((m) => m.text),
          })),
        })
      : Promise.resolve({ translated: false });
    const defPromise = definitionNeeded
      ? ctx.runAction(internal.translate.translateWordDefinition, {
          targetCode,
          lang,
          word: word.word,
          pos: word.pos,
          meaning: word.translations[lang]?.transWord || existingTransDfn,
          hanjaContext: presentHanja.map((d) => ({
            character: d.character,
            englishMeanings: d.meanings.map((m) => m.text),
          })),
        })
      : Promise.resolve({ translated: false });

    let charResult = { translatedCount: 0 };
    let wordResult = { translated: false };
    let defResult = { translated: false };
    try {
      [charResult, wordResult, defResult] = await Promise.all([
        charPromise,
        wordPromise,
        defPromise,
      ]);
    } catch (err) {
      console.error("scheduledTranslateAndEdit: translation failed", err);
    }
    const producedSomething =
      charResult.translatedCount > 0 ||
      wordResult.translated ||
      defResult.translated;

    // Re-query so the re-render reflects whatever made it into the cache.
    const finalWord =
      (await ctx.runQuery(internal.words.getByTargetCode, { targetCode })) ??
      word;
    const refreshedHanja = chars.length > 0
      ? await ctx.runQuery(internal.hanja.getByCharacters, { characters: chars })
      : [];
    const display: DisplayResult = {
      word: finalWord.word,
      origin: finalWord.origin,
      targetCode: finalWord.targetCode,
      pos: finalWord.pos,
      definition: finalWord.definition,
      translations: finalWord.translations,
    };

    let body = formatWordResult(display, refreshedHanja, chars, lang);
    if (attempted && !producedSomething) {
      body += `\n\n${t(lang).aiTranslateFailed}`;
    }

    const bot = new Bot(token);
    try {
      await bot.api.editMessageText(chatId, messageId, body, {
        parse_mode: "HTML",
      });
    } catch (err) {
      // Includes Telegram's "message is not modified" when nothing changed.
      console.error("scheduledTranslateAndEdit: editMessageText failed", err);
    }
  },
});
