# Handling Multiple Word Meanings (Homographs)

> Status: **design note, not yet implemented**. This document captures the
> problem and the agreed-upon approach so it can be picked up later.

## Problem

Some Korean words map to several distinct Hanja origins with completely
different meanings. The canonical example is **경기**:

| Hangul | Hanja | Meaning         |
|--------|-------|-----------------|
| 경기   | 競技  | competition     |
| 경기   | 京畿  | Gyeonggi province |
| 경기   | 景氣  | economy / business climate |
| 경기   | 驚氣  | convulsions     |

Other common examples: **사과** (謝過 apology / 沙果 apple), **차** (茶 tea /
車 car), **배** (배 pear / 船 ship / 腹 belly, etc.).

The KRDict API returns all of these as separate items on a single search,
but the bot currently surfaces only the first one and caches only that one
row per word, so users never see the alternatives.

## Current behaviour

The single-meaning assumption is baked in at several layers:

- `convex/krdict.ts:45-84` — `searchWord` already returns **all** results
  from the API as `KrdictSearchResult[]`. Each item has a unique
  `targetCode`. No change needed here.
- `convex/telegram.ts:9-16` — `findExactMatch` picks only the first match:
  ```ts
  const exact = results.find((r) => r.word === query) ?? null;
  ```
- `convex/telegram.ts:154-161` — `searchFromApi` saves only that single
  match into the cache.
- `convex/words.ts:4-33` — `getByWord` uses `.first()`, and `save` inserts
  only when no row exists for the word, so subsequent meanings are dropped.
- `convex/schema.ts:13-21` — the `words` table has only a `by_word` index;
  there is no index on `targetCode`, which we would need for point lookups
  of an individual meaning.

## Proposed design

### Schema (`convex/schema.ts`)

Keep the same fields but add a second index so we can fetch a specific
meaning by its unique KRDict `targetCode`:

```ts
words: defineTable({ /* unchanged */ })
  .index("by_word", ["word"])
  .index("by_target_code", ["targetCode"]),
```

### Cache layer (`convex/words.ts`)

Replace the single-row helpers with multi-row variants:

- `getAllByWord({ word })` — returns all rows for a word via
  `.withIndex("by_word", q => q.eq("word", word)).collect()`.
- `getByTargetCode({ targetCode })` — point lookup via the new index.
- `saveMany({ entries })` — for each entry, look up by `targetCode` and
  insert if missing. This is an upsert-by-`targetCode` dedup so re-running
  a search never creates duplicates.

The old `getByWord` / `save` are removed — no backwards-compat shims.

### Telegram flow (`convex/telegram.ts`)

1. **`findExactMatches`** (replaces `findExactMatch`, lines 9-16) returns
   `{ exact: KrdictSearchResult[], suggestions }`, where `exact` contains
   **every** result whose `word === query`.
2. **`getCached` / `searchFromApi`** (lines 150-161) both return
   `KrdictSearchResult[]`. `searchFromApi` calls `saveMany` with all exact
   matches *before* responding, guaranteeing every `targetCode` shown to
   the user is persisted and therefore any later `m:` callback can resolve
   it.
3. **Extract** a `renderSingleResult(ctx, result, loadingMsg)` helper from
   the existing render block at lines 216-240 (format result, build the
   hanja-character keyboard, send-or-edit). Reuse it from the message
   handler, the `s:` suggestion callback, and the new `m:` callback to
   avoid duplication.
4. **New helper** `buildMeaningKeyboard(matches)`: one button per meaning,
   label `${origin} · ${transWord || definition}` truncated to ≤60 chars,
   callback data `m:${targetCode}`. `targetCode` is numeric, so the
   payload stays well under Telegram's 64-byte callback_data limit.
5. **Message handler** (lines 164-245) branches on `exact.length`:
   - `0` → existing suggestions path (unchanged).
   - `1` → `renderSingleResult` (unchanged UX).
   - `>1` → send `"Multiple meanings for <b>{word}</b>:"` with
     `buildMeaningKeyboard(exact)`.
6. **`s:` callback** (lines 256-307) uses the same three-way branch and
   the shared helper.
7. **New `m:` callback** (slot before the `ha:` block at line 308):
   ```ts
   } else if (data.startsWith("m:")) {
     const tc = Number(data.slice(2));
     const doc = await actionCtx.runQuery(
       internal.words.getByTargetCode,
       { targetCode: tc },
     );
     if (!doc) await ctx.reply("Meaning no longer cached, please search again.");
     else await renderSingleResult(ctx, doc, null);
   }
   ```

## Edge cases

- **Single meaning** → identical UX to today.
- **No exact match** → existing suggestions / `s:` flow unchanged. If a
  picked suggestion itself has multiple meanings, the meaning keyboard
  appears on the next step.
- **Cache hit with multiple rows** → `getCached` returns the array, no API
  call needed, the multi-meaning branch triggers directly.
- **Empty `origin`** → keyboard label falls back to `"—"`.
- **Stale `m:` after a restart** → mitigated because `saveMany` persists
  every meaning *before* the keyboard is shown, so any `targetCode`
  referenced by a live button is guaranteed to be in the DB.
- **Partial cache** (KRDict later adds another meaning) → `saveMany` is
  upsert-by-`targetCode` so new meanings are added on the next search
  without duplicating existing ones. Detecting partial cache and forcing
  a refetch is explicitly out of scope.

## Files to modify when implementing

- `convex/schema.ts` — add `by_target_code` index.
- `convex/words.ts` — replace `getByWord` / `save` with `getAllByWord`,
  `getByTargetCode`, `saveMany`.
- `convex/telegram.ts` — `findExactMatches`, array-returning cache
  helpers, `renderSingleResult` extraction, `buildMeaningKeyboard`,
  multi-meaning branch in the message handler and `s:` callback, new
  `m:` callback.

`convex/krdict.ts` needs no changes — it already returns all results.

## Verification steps for the eventual implementer

1. `bunx convex dev` to push the new index and updated functions.
2. Send **경기** to the bot → expect a "Multiple meanings" keyboard
   listing 競技 / 京畿 / 景氣 / 驚氣. Tapping each should show the
   standard single-result view with its hanja-character buttons.
3. Send **사과** (謝過 apology / 沙果 apple) → same multi-meaning UX.
4. Send a single-meaning word such as **학교** → unchanged single-result
   UX.
5. Send a misspelling → unchanged "Did you mean…" suggestions; tapping a
   suggestion that itself has multiple meanings should surface the
   meaning keyboard.
6. Re-send 경기 after the first lookup → should be served from cache (no
   spinner) and still show the meaning keyboard.
