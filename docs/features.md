# Review & Learn Features

Specification for two small learning-oriented features to add to the Hanjaro
bot. **Not yet implemented** — this document is the design to follow when
implementing them.

## Overview

The bot is currently a stateless reference tool: send a Hanja or a Korean
word, get a lookup. These two features move the bot slightly beyond pure
lookup without turning it into a full-blown SRS:

1. **Review seen Hanja** — the user can ⭐ any Hanja they've searched for,
   and later use `/review` to see saved characters again.
2. **Learn new Hanja** — `/learn` walks the user through an ordered list of
   beginner-friendly Hanja one character at a time, never repeating a
   character the user has already seen.

Both features key their per-user state off `ctx.from.id` (the Telegram user
id). No `users` table is introduced — each feature gets its own small table
that carries the user id directly.

## Current behavior (for reference)

- Entry point: `convex/telegram.ts:367` — `bot.on("message:text", ...)`.
- Callback handler: `convex/telegram.ts:405`, existing prefixes `s:`, `wq:`,
  `hh:`, `hp:`, `m:`.
- Single-Hanja response is built inside the `handleSingleHanja` flow and
  uses the Hanja formatter in the same file.
- Hanja DB lookup: `internal.hanja.getByCharacters` (`convex/hanja.ts:60`).
- Schema: only `hanja` and `words` tables exist (`convex/schema.ts`). No
  per-user state of any kind.
- Commands registered with Telegram: see `convex/registerWebhook.ts` — only
  `/start` today.

---

## Feature 1 — Review seen Hanja

### Goals

1. Let the user mark any Hanja they've looked up as "saved for later".
2. Let the user pull saved Hanja back up with a simple `/review` command.
3. Surface saved/unsaved state visibly on the lookup response so the user
   always knows what's in their list.

### UX flow

#### Saving from a lookup

Every single-Hanja lookup response gains an inline keyboard row with a star
button:

- **Not saved:** `⭐ Save`
- **Already saved:** `✅ Saved`

Tapping the button toggles the state. The bot edits the same message
in-place and flips the button label. This reuses the existing
`ctx.editMessageText` pattern already used for pagination in
`convex/telegram.ts`.

#### `/review` command

- If the user has **nothing saved** yet:
  > You haven't saved any Hanja yet. Send me a Hanja character and tap ⭐ to
  > save it for review.
- If the user **has saved Hanja**:
  1. Pick one saved Hanja (see Open Questions — random vs oldest-first).
  2. Show only the character itself in large form, plus a progress footer
     like `🔁 Reviewing 1 of 12`.
  3. Inline keyboard:
     - `Show meaning` → reveals the full Hanja detail (reuses the Hanja
       formatter), keeps the card on-screen.
     - `⏭ Next` → draws another saved Hanja.
     - `Done` → ends the review session with a short summary.

### Data model changes

New table in `convex/schema.ts`:

```ts
saved_hanja: defineTable({
  userId: v.string(),     // ctx.from.id.toString()
  character: v.string(),  // single Hanja character
  savedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_char", ["userId", "character"]),
```

- `by_user` — list all saved characters for one user (for `/review`).
- `by_user_char` — O(1) "is this character already saved by this user?"
  check, used both to pick the correct button label and to implement the
  toggle.

### New Convex file

`convex/saved.ts` with:

- `isSaved(userId, character) → boolean`
- `toggleSaved(userId, character) → { saved: boolean }` — inserts if absent,
  deletes if present.
- `listForUser(userId) → Array<{ character, savedAt }>`
- `pickRandomForUser(userId) → { character } | null`

### New callback prefixes

Add to the callback dispatcher at `convex/telegram.ts:405`:

- `sv:<char>` — toggle save/unsave for `<char>`. On success, re-render the
  Hanja detail view in place so the star/check button label updates.
- `rv:next` — draw and render another review card for the caller.
- `rv:show:<char>` — reveal the full Hanja detail for the current review
  card (expands "show meaning").

Callback data stays well under Telegram's 64-byte limit: a Hanja character
is 3 UTF-8 bytes, so `sv:<char>` is ~6 bytes.

### Files that would change

- `convex/schema.ts` — add `saved_hanja` table and both indexes.
- `convex/saved.ts` — **new** — queries and mutations above.
- `convex/telegram.ts`:
  - Append the ⭐/✅ row to the inline keyboard built inside the single-Hanja
    response, using `saved.isSaved` to choose the label.
  - Add a `/review` command handler.
  - Add the `sv:`, `rv:next`, `rv:show:` branches to the callback dispatcher.
- `convex/registerWebhook.ts` — add `/review` to the registered commands
  list so it shows up in Telegram's command menu.

---

## Feature 2 — Learn new Hanja

### Goals

1. Introduce Hanja characters one at a time, starting from a beginner-safe
   set.
2. Never re-show a character the user has already seen or skipped.
3. Give the user a visible sense of progression (`N / total`).

### Prerequisite — a curated, tested Hanja list

**This feature does not ship on top of the full Unihan dump.** The `hanja`
table today contains tens of thousands of characters in no pedagogical
order, which is useless for "learn one at a time from the beginning". A
learner pulling a random character out of that set would hit obscure CJK
characters immediately.

Before implementing `/learn`, we need a small, vetted, ordered list of
beginner Hanja. The recommended source is the **Korean Hanja Proficiency
Test (한자능력검정시험) published by 한국어문회**, which Korean students use
as the standard progression:

| Level | New characters | Cumulative |
|------:|---------------:|-----------:|
| 8급   | 50             | 50         |
| 7급   | 100            | 150        |
| 6급   | 150            | 300        |
| …     | …              | …          |

These lists are canonical, publicly known, and used in every Korean Hanja
textbook — exactly the "tested and working" property we want, instead of a
hand-rolled ordering we'd have to justify.

**v1 scope:** ship 8급 only (50 characters). v2 extends to 7급, and so on,
with zero schema changes.

#### Concrete prep step (done before or as part of the implementation PR)

- Commit `data/hanja-learning-order.json` with the 8급 list in pedagogical
  order:

  ```json
  {
    "level": "8급",
    "source": "한국어문회 한자능력검정시험",
    "order": ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "…"]
  }
  ```

- Sanity-check: every character in the file must already exist in the
  `hanja` table after running `scripts/seedHanja.ts`. If any are missing,
  add them to `data/hanja-overrides.json` so the seed picks them up.

### UX flow

- User sends `/learn`.
- Bot walks the ordered list and returns the **first character the current
  user has not yet marked `seen` or `skipped`**.
- Renders the character using the existing Hanja formatter (meanings,
  hangul reading, etc.) and appends a footer like:
  > 📚 3 / 50 learned
- Inline keyboard: `[✓ Got it]  [⏭ Skip]`
- Tapping either button records the user's decision in
  `user_hanja_progress` and **edits the same message in place** to show the
  next unseen character.
- When the user has decided on every character in the list:
  > 🎉 You've learned all 50 Level 8 Hanja! More levels coming soon.

### Data model changes

New data file: `data/hanja-learning-order.json` (see prerequisite above).

New table in `convex/schema.ts`:

```ts
user_hanja_progress: defineTable({
  userId: v.string(),
  character: v.string(),
  status: v.union(v.literal("seen"), v.literal("skipped")),
  seenAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_char", ["userId", "character"]),
```

- `by_user` — fetch all progress rows for a user, then diff against the
  ordered list to find the next unseen character.
- `by_user_char` — cheap "has the user already decided on this character?"
  check, used on every tap.

### New Convex file

`convex/learning.ts` with:

- `getNextForUser(userId) → { character, index, total } | null`
- `markSeen(userId, character)`
- `markSkipped(userId, character)`

The learning order is loaded from `data/hanja-learning-order.json`. The
file is small (≤ a few KB even at 6급) so reading it on each call is fine;
an in-memory cache can be added later if needed.

### New callback prefixes

- `ln:seen:<char>` — record the character as `seen` and advance.
- `ln:skip:<char>` — record the character as `skipped` and advance.

Both payloads are ≤ 12 bytes, well under the 64-byte Telegram limit.

### Files that would change

- `convex/schema.ts` — add `user_hanja_progress` table and indexes.
- `data/hanja-learning-order.json` — **new** — ordered 8급 list.
- `convex/learning.ts` — **new** — queries and mutations above.
- `convex/telegram.ts`:
  - Add a `/learn` command handler.
  - Add the `ln:seen:` and `ln:skip:` branches to the callback dispatcher.
- `convex/registerWebhook.ts` — add `/learn` to the registered commands.

---

## Shared notes

- Both features key per-user state off `ctx.from.id.toString()`. No `users`
  table is introduced in either feature.
- Both features reuse the existing single-Hanja formatter in
  `convex/telegram.ts` — neither introduces a parallel rendering path.
- Callback data for both features fits comfortably under Telegram's 64-byte
  limit.
- Message-edit-in-place is preferred over sending new messages for
  toggling/advancing, following the pattern already used for Hangul→Hanja
  pagination (`hh:` / `hp:` in `convex/telegram.ts`).

## Open questions

1. **Star toggle direction.** Does tapping ⭐ on an already-saved Hanja
   unsave it, or is saving one-way with an explicit "remove" path?
   Recommended: toggle. Simpler, expected, and the button label already
   signals the current state.
2. **`/review` ordering.** Random, oldest-first, or most-recently-saved
   first? Recommended: random for v1 — lowest cognitive load, feels like a
   shuffle.
3. **Skipped-in-/learn behavior.** Does a skipped character come back later
   or is it gone for good? Recommended for v1: gone for good. A future
   `/progress` or re-review command can specifically revisit
   `status: "skipped"` rows.
4. **`/progress` command.** Include a simple `📚 12 / 50 learned,
   3 skipped, 5 saved` readout in v1, or leave for a follow-up?
5. **Promotion from `/learn` to "saved".** Should "Got it" also auto-save
   the character to the review list, or are learning progress and saved
   items kept strictly separate? Recommended: keep separate — saving is an
   explicit user action via ⭐, learning progress is internal.

## Out of scope

- Spaced repetition scheduling (no intervals, no due dates).
- Scoring, XP, streaks, or any gamification layer.
- Importing external frequency data for the learning order — the 한국어문회
  levels are the intentional, complete ordering.
- Multi-Hanja or word-level learning — the scope is single characters only,
  matching the rest of the bot's current model.
