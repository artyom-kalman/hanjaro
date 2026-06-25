# Spec: AI Word-Level Translation

## Objective

**What:** When KrDict provides no translation for a looked-up word in the user's language, use an LLM to translate the *whole word* (a concise gloss + a rendering of the Korean definition into that language), then upgrade the bot message in place. Works for **both English and Russian**.

**Why:** KrDict's translation coverage has gaps — sparse for Russian, and still incomplete for English (especially pure Korean words and rarer entries). Today, users searching such words see either:

- **Hanja-origin words** (e.g. `신문 · 新聞`, `정신 · 精神`) — only the per-character Hanja breakdown, with no actual word meaning. The user has to *guess* the word from its parts (新 "new" + 聞 "hear/news" → ??? instead of "газета / newspaper").
- **Pure Korean words** (e.g. `낯설다`, an adjective) — no Hanja breakdown **and** no translation. The result is nearly empty (just the word + part of speech).

There is already an AI feature, but it is narrow: it only translates **per-Hanja-character glosses** (EN→RU), never the word itself. This spec adds **word-level** AI translation as a sibling capability.

**Who:** Both English and Russian users of the bot (`lang === "en"` or `"ru"`).

**Success looks like:** For any exact-match word lookup with no KrDict `transWord` in the user's language, the user shortly sees a word gloss + definition appear in the same message in their language, clearly marked as AI-generated.

---

## Decisions (locked with the user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **Both** Hanja-origin words **and** pure Korean words. |
| 2 | Output | **Gloss + definition** — translate `transWord` AND the Korean `definition` → `transDfn`, grounded on the KrDict Korean definition. |
| 3 | Trigger | **Automatic background**, edits the message in place — matches the existing char-translation UX. |
| 4 | Call structure | **Separate** LLM call from the existing char-translation call. The word-translation prompt **also includes the Hanja characters (and their English meanings)** as grounding context. |
| 5 | Languages | Word translation for **both `en` and `ru`**. Hanja *char-gloss* AI translation stays **`ru`-only** — English Hanja glosses come from Unihan natively, so they never need translating. |

**Assumptions confirmed:**

- Word translation works for both English and Russian. The existing Hanja char-gloss AI translation stays Russian-only.
- Trigger only when KrDict gives **no** `transWord` for the user's language — never overwrite a real KrDict translation.
- Cache the AI result in `words.translations.ru` with a `source` marker so we (a) don't confuse it with KrDict data, (b) can stamp the "translated by AI" footer correctly, (c) can re-derive later.
- Reuse OpenRouter + Gemini 3.1 Flash Lite + the existing timeout/retry config in `convex/translate.ts`.
- Same in-place message-edit pattern (immediate result → background upgrade) as the Hanja flow.

---

## Tech Stack

- **Runtime / backend:** Convex (`internalAction`, `internalMutation`, `internalQuery`), TypeScript ESM.
- **Bot framework:** grammY (`grammy`).
- **LLM:** OpenRouter (OpenAI-compatible SDK, `openai`), model `google/gemini-3.1-flash-lite`, JSON mode.
- **Dictionary source:** KrDict API (`convex/krdict.ts`).
- **Package manager:** `bun` / `bunx` (never `npm`/`npx`).

---

## Commands

```
Dev (Convex):      bunx convex dev
Deploy (prod):     bunx convex deploy --prod
Register webhook:  bun run register:dev   |   bun run register:prod
Run a function:    bunx convex run <module>:<fn> '<jsonArgs>'
```

No build/test/lint scripts currently exist in `package.json`.

---

## Project Structure

```
convex/
  schema.ts          → DB tables (words, hanja, userSettings)
  telegram.ts        → webhook handler, message routing, lookup orchestration
  translate.ts       → OpenRouter calls + scheduled background "upgrade" action
  hanjaFormat.ts     → message rendering (breakdown, hangul page, AI footer)
  words.ts           → words-table queries/mutations
  hanja.ts           → hanja-table queries/mutations
  krdict.ts          → KrDict API client
  i18n.ts            → UI strings (EN/RU)
docs/                → specs & plans (this file lives here)
```

This feature touches: `schema.ts`, `words.ts`, `translate.ts`, `telegram.ts`, `hanjaFormat.ts`, `i18n.ts`. No new files strictly required (a new action + mutation can live in `translate.ts` / `words.ts`).

---

## Behavior

### Trigger condition

A word needs AI word-translation when **both** hold:

- the user's `lang` is `en` or `ru`, and
- the exact-match word's `translations[lang]` is absent **or** its `transWord` is the empty string.

Once filled by AI (`transWord` non-empty, `source: "ai"`), the condition is false on subsequent lookups in that language → served instantly from cache, no LLM call.

### Flow (mirrors the existing Hanja upgrade)

1. **Synchronous (inside webhook):** word lookup resolves and the result message is sent immediately, exactly as today (word + POS; Hanja breakdown if any; no word translation line yet if KrDict had none).
2. **Schedule:** schedule the background **orchestrator** with `{ chatId, messageId, targetCode, lang }` when *either* (a) `lang === "ru"` and any Hanja char is missing its RU gloss, *or* (b) the word is missing its `transWord` in `lang` (en or ru).
3. **Background orchestrator** (generalized `scheduledTranslateAndEdit`):
   - Re-derives everything from `targetCode` + `lang`: re-query the word, compute its Hanja chars, re-query Hanja docs.
   - Runs the needed **independent** LLM calls concurrently:
     - `translateHanjaToRu` for missing per-char glosses — **RU only** (English Hanja glosses come from Unihan natively, so no char translation ever runs for English);
     - new `translateWordToLang` for the word — **en or ru**.
   - Re-queries the now-updated word + Hanja docs, **re-renders the full message** (`formatSearchResult` prefix + breakdown), and performs **one** `editMessageText`.
   - This single-edit design is what makes "separate LLM calls" safe — two actions editing the same message would race.

> **Why re-derive from `targetCode`:** the current code freezes the rendered `prefix` string at schedule time, so a newly-added word translation could never appear in it. Re-rendering inside the orchestrator fixes this and shrinks the scheduled args to a few small fields (`chatId`, `messageId`, `targetCode`, `lang`).

### Word-translation LLM call (`translateWordToLang`)

- **Inputs:** `targetCode`, `lang` (`en` | `ru`), `word`, `origin`, `pos`, Korean `definition`, and Hanja context = `[{ character, englishMeanings[] }]` for each Hanja char in the word.
- **Prompt (shape):** target language is interpolated (`English` / `Russian`):
  ```
  Translate a Korean dictionary word into {English|Russian}.
  Provide (1) a concise gloss (dictionary-style, one word / short phrase),
  and (2) a translation of the Korean definition.
  Use the Hanja origin and the Korean definition to fix the precise sense.

  Word: 신문
  Part of speech: 명사
  Hanja: 新聞
    新 = new, fresh
    聞 = hear, news
  Korean definition: <krdict definition>

  Return strict JSON only: {"transWord":"...","transDfn":"..."}
  ```
  (Omit the Hanja block for pure Korean words.)
- **Output:** `{ transWord, transDfn }`. Treated as success only if `transWord` is non-empty after trimming.
- **Persist:** patch `words.translations[lang] = { transWord, transDfn, source: "ai" }`, preserving the other language via spread.

### AI footer (`✨ Перевод с помощью ИИ`)

Currently appended inside `formatHanjaBreakdown` when any Hanja gloss was AI-translated. It must now also appear when the **word** was AI-translated (otherwise `낯설다` gets an AI translation with no AI stamp).

Plan: centralize the footer decision at message-assembly level — the footer is shown once when `(any rendered Hanja gloss is AI)` **OR** `(word translation source === "ai")`. The `source` marker is what lets us avoid stamping "AI" on genuine KrDict translations. The footer text is already language-aware in `i18n.ts` (`aiTranslationNote`: EN `✨ Translated with AI`, RU `✨ Перевод с помощью ИИ`), so it renders correctly for both languages.

### Failure handling

If the word LLM call fails or returns an empty `transWord`, no word line is added (message stays as it was). A single **generic** unavailable-translation note (`aiTranslateFailed`, renamed from the current `hanjaTranslateFailed`, used for both char and word failures) is appended only when an attempt was made and produced nothing new. Identical-text edits (nothing changed) are tolerated — the edit error is already caught and logged.

---

## Schema Change

`convex/schema.ts` — add an optional `source` to the per-language translation object in `words`:

```ts
translations: v.object({
  en: v.optional(v.object({
    transWord: v.string(),
    transDfn: v.string(),
    source: v.optional(v.union(v.literal("krdict"), v.literal("ai"))),
  })),
  ru: v.optional(v.object({
    transWord: v.string(),
    transDfn: v.string(),
    source: v.optional(v.union(v.literal("krdict"), v.literal("ai"))),
  })),
}),
```

**Backward-compatible:** `source` is optional, so existing rows (no `source`) remain valid and are treated as KrDict-sourced. **No data migration needed.**

---

## Code Style

Match `convex/translate.ts`: Convex `internalAction`/`internalMutation` with `v` validators; OpenAI SDK pointed at OpenRouter; `console.error` for failures; graceful degradation (return a zero/`false` result rather than throwing up to the webhook). Example of the persist mutation:

```ts
export const saveAiWordTranslation = internalMutation({
  args: {
    targetCode: v.number(),
    lang: v.union(v.literal("en"), v.literal("ru")),
    transWord: v.string(),
    transDfn: v.string(),
  },
  handler: async (ctx, { targetCode, lang, transWord, transDfn }) => {
    const doc = await ctx.db
      .query("words")
      .withIndex("by_target_code", (q) => q.eq("targetCode", targetCode))
      .first();
    if (!doc) return;
    await ctx.db.patch(doc._id, {
      translations: {
        ...doc.translations,
        [lang]: { transWord, transDfn, source: "ai" as const },
      },
    });
  },
});
```

---

## Testing Strategy

No test framework exists today; this feature **adds `bun:test`** (the project already runs on Bun).

- **Pure helpers** (`buildWordPrompt`, `parseWordResponse`, footer-decision helper) get unit tests — JSON parsing, ` ```json ` fence stripping, empty-field handling, footer on/off keyed by `source`. These are the highest-value units and have no Convex/network deps.
- Add a `test` script to `package.json` (`"test": "bun test"`).
- **End-to-end** — manual verification through the live bot + `bunx convex run` for the actions. See Success Criteria.

---

## Boundaries

- **Always:** keep the synchronous webhook path fast (LLM work stays in the scheduled action); preserve `translations.en` when patching; mark AI output with `source: "ai"`; show the AI footer whenever AI text is rendered.
- **Ask first:** adding new runtime dependencies; changing the LLM model or prompt strategy; AI-translating Hanja *char* glosses for English (out of scope — English glosses are native Unihan).
- **Never:** overwrite a real KrDict `transWord` with AI output; commit secrets (`OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`); make a second concurrent `editMessageText` on the same message (single-edit invariant).

---

## Success Criteria

1. **Hanja word, no KrDict RU** — send `신문` (lang=ru): message first shows breakdown only, then upgrades in place to include a Russian word gloss (≈ "газета") + Russian definition, with the `✨ Перевод с помощью ИИ` footer.
2. **Pure Korean word, RU** — send `낯설다` (lang=ru): message upgrades from word+POS-only to include a Russian gloss + definition + footer.
3. **Word, no KrDict EN** — send a Korean word KrDict lacks an English translation for (lang=en): message upgrades to include an English gloss + definition + `✨ Translated with AI` footer. Hanja breakdown stays native English (no char AI call fires).
4. **No overwrite** — a word that *has* a KrDict `transWord` in the user's language shows it unchanged, no AI call, no AI footer.
5. **Caching** — looking up the same AI-translated word again (same language) is instant (no LLM call), still shows the footer (read from `source: "ai"`).
6. **Char glosses for EN stay native** — English Hanja breakdowns are never AI-translated (Unihan source); no char AI footer for English from char glosses.
7. **Graceful failure** — with the LLM unreachable, the message is not left broken; no spurious word line; existing flow still works.
8. **No race** — Hanja + word translation for the same word result in exactly one final message edit.

---

## Resolved Decisions (follow-up)

1. **LLM call concurrency:** char + word calls run **concurrently** when both are needed (RU Hanja words); the word call uses English Hanja meanings as context. For English only the word call ever runs.
2. **Failure note:** **generic** — rename `hanjaTranslateFailed` → `aiTranslateFailed` and reuse it for both char and word translation failures.
3. **Tests:** **add `bun:test`** now, covering the pure helpers; add a `bun test` script to `package.json`.
