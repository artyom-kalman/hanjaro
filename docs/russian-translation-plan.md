# Plan: Add Russian Language Support to Hanjaro Bot

## Context

The Hanjaro Telegram bot helps users learn Korean Hanja. All user-facing text and lookup data is currently in English. The goal is to **add Russian as a second language** (not replace English), so users can choose their preferred language via a `/settings` command. Per-user language preference is stored in the DB.

**Key discovery**: The KrDict API natively supports Russian translations via `trans_lang: "10"`, so no external translator is needed for word lookups.

**Scope for this phase**: Per-user language settings + Russian translations from KrDict. Hanja meaning translation and full UI i18n will come later.

---

## Step 1: Update `words` table schema — nested translations

**File: `convex/schema.ts`**

Replace the flat `transWord`/`transDfn` fields with a nested `translations` object. One document per word meaning (keyed by `targetCode`), with translations stored per language:

```ts
words: defineTable({
  word: v.string(),
  origin: v.string(),
  targetCode: v.number(),
  pos: v.string(),
  definition: v.string(),
  translations: v.object({
    en: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
    ru: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
  }),
})
  .index("by_word", ["word"])
  .index("by_target_code", ["targetCode"]),
```

Since this is a schema change (removing `transWord`/`transDfn`, adding `translations`), we need to **migrate existing cached data** — see the Migration section below for the 3-deploy sequence that moves existing English translations into `translations.en`.

---

## Step 2: Add `userSettings` table

**File: `convex/schema.ts`**

```ts
userSettings: defineTable({
  telegramUserId: v.number(),
  lang: v.string(),  // "en" | "ru"
}).index("by_telegram_user_id", ["telegramUserId"]),
```

**New file: `convex/userSettings.ts`**

- `getByTelegramUserId(telegramUserId)` — internalQuery, returns user's settings or null
- `setLang(telegramUserId, lang)` — internalMutation, upserts the language preference

---

## Step 3: Make KrDict API language-aware

**File: `convex/krdict.ts`**

- Add `lang` parameter to `searchWord(apiKey, query, lang)`
- Map: `{ en: "1", ru: "10" }`
- Pass the mapped value as `trans_lang` in the API request
- Return type stays the same (`KrdictSearchResult[]` with `transWord`/`transDfn`)

---

## Step 4: Update `convex/words.ts` for new schema

**File: `convex/words.ts`**

Update all functions to work with the nested `translations` structure:

- `getAllByWord(word)` — unchanged query, but returned docs now have `translations` object
- `getByTargetCode(targetCode)` — unchanged query, new shape
- `saveMany(entries, lang)` — when saving KrDict results:
  - Check if a doc with that `targetCode` already exists
  - If exists: **patch** it to add the new language's translation (e.g., add `translations.ru` while keeping `translations.en`)
  - If new: insert with the fetched language's translation
- Add `migrateToTranslations`/`migrateAll` for the data migration (see Migration section)

---

## Step 5: Thread language through bot logic

**File: `convex/telegram.ts`**

**New type** (replacing `DisplayResult`):
```ts
type DisplayResult = {
  word: string;
  origin: string;
  targetCode: number;
  pos: string;
  definition: string;
  translations: {
    en?: { transWord: string; transDfn: string };
    ru?: { transWord: string; transDfn: string };
  };
};
```

**At the start of handlers**, read user language:
- In `bot.on("message:text")` and `bot.on("callback_query:data")`: call `userSettings.getByTelegramUserId(ctx.from.id)`, default to `"en"`

**Pass `lang` through the call chain:**
- `handleWordLookup(ctx, word, sendLoading, lang)`
- `resolveWord(word, sendLoading, api, lang)`
- `getCached(word)` — returns docs with `translations` (no lang filter needed, one doc has all langs)
- `searchFromApi(word, lang)` — calls `searchWord(apiKey, word, lang)`, saves with `lang`

**Cache logic in `resolveWord`:**
1. Check cache: `getCached(word)`
2. If cached docs exist AND have the user's language in `translations` → use cached
3. If cached docs exist but MISSING the user's language → call KrDict API with that lang, **patch** existing docs to add the translation
4. If no cached docs → call KrDict API, insert new docs

**Update `formatSearchResult(result, lang)`:**
- Pick `translations[lang]` (fall back to `translations.en` if the requested lang is missing)
- Show `🇷🇺` for Russian, `🇬🇧` for English

---

## Step 6: Add `/settings` command

**File: `convex/telegram.ts`**

Add `/settings` command handler:
- Shows current language setting
- Inline keyboard with two buttons: `🇬🇧 English` (`lang:en`) / `🇷🇺 Русский` (`lang:ru`)

Add callback handler for `lang:en` / `lang:ru`:
- Calls `userSettings.setLang(telegramUserId, lang)`
- Edits message to confirm: "Language set to English / Язык: Русский"

Register the command in `convex/registerWebhook.ts`:
- Add `{ command: "settings", description: "Language / Язык" }` to the commands array

---

## Files to Modify

| File | Changes |
|------|---------|
| `convex/schema.ts` | Add `userSettings` table; restructure `words` with nested `translations` |
| `convex/words.ts` | Adapt to new schema; add lang-aware save with upsert |
| `convex/krdict.ts` | Add `lang` param to `searchWord`, map to `trans_lang` code |
| `convex/telegram.ts` | Read user lang, thread through lookups, `/settings` command, `lang:*` callbacks, dynamic flag emoji |
| `convex/registerWebhook.ts` | Register `/settings` command |

## New Files

| File | Purpose |
|------|---------|
| `convex/userSettings.ts` | Get/set per-user language preference |

## Migration: Existing Word Cache (English → nested translations)

Existing `words` documents have flat `transWord`/`transDfn` fields. We migrate them into `translations.en` in a 3-deploy sequence:

### Deploy 1: Transitional schema + migration function

Update `convex/schema.ts` with a **transitional** words schema that accepts both old and new shapes:

```ts
words: defineTable({
  word: v.string(),
  origin: v.string(),
  targetCode: v.number(),
  pos: v.string(),
  definition: v.string(),
  // Old fields — optional during migration
  transWord: v.optional(v.string()),
  transDfn: v.optional(v.string()),
  // New field — optional during migration
  translations: v.optional(v.object({
    en: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
    ru: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
  })),
}).index("by_word", ["word"])
  .index("by_target_code", ["targetCode"]),
```

Add a `migrateToTranslations` mutation in `convex/words.ts` that:
1. Reads a batch of docs that still have `transWord` but no `translations`
2. For each doc, uses `ctx.db.replace(id, newDoc)` to:
   - Move `transWord`/`transDfn` into `translations: { en: { transWord, transDfn } }`
   - Drop the old flat `transWord`/`transDfn` fields
3. Returns count of migrated docs (0 means done)

Also add a `migrateAll` action that loops calling `migrateToTranslations` in batches.

**Run**: `bunx convex run words:migrateAll '{}'`

### Deploy 2: Final schema

After migration completes, update `convex/schema.ts` to the **final** words schema (no more optional old fields):

```ts
words: defineTable({
  word: v.string(),
  origin: v.string(),
  targetCode: v.number(),
  pos: v.string(),
  definition: v.string(),
  translations: v.object({
    en: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
    ru: v.optional(v.object({ transWord: v.string(), transDfn: v.string() })),
  }),
}).index("by_word", ["word"])
  .index("by_target_code", ["targetCode"]),
```

Remove the migration functions from `words.ts` (no longer needed).

### Deploy 3: Register webhook

Run `bun run register:dev` (or `register:prod`) to register the new `/settings` command.

### Summary

```
Deploy 1 → transitional schema + migration mutation
  ↓ run: bunx convex run words:migrateAll '{}'
Deploy 2 → final schema, remove migration code
Deploy 3 → re-register webhook for /settings command
```

## Verification

1. `/settings` → shows language picker, stores preference
2. Send `학생` with lang=ru → Russian `transWord`/`transDfn` from KrDict, flag 🇷🇺
3. Send `학생` with lang=en → English translations, flag 🇬🇧
4. Switch language via `/settings` → next lookup uses new language
5. Look up same word in both languages → single document in DB with both `translations.en` and `translations.ru`
6. New user (no settings) → defaults to English

## Out of Scope (later phases)

- Translating static UI strings (error messages, buttons, etc.) to Russian
- Translating Hanja character meanings to Russian (batch via Google Translate)
- Full i18n framework for the bot
- POS map translation
