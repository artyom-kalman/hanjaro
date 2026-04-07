# Input Handling Redesign

Specification for how the Hanjaro bot should route user messages. **Not yet
implemented** — this document is the design to follow when implementing the
feature.

## Goals

1. Reply to `/start` (and to unrecognized input) with a usage message plus
   examples.
2. Continue to look up multi-syllable Korean words via krdict as today.
3. For a single Hangul syllable, ask the user whether they want a word lookup
   or all Hanja that share that reading.
4. For a single Hanja (CJK) character, show its meaning directly.
5. For multiple Hanja characters in one message, ask the user to send just one
   at a time.

## Current behavior (for reference)

- Entry point: `convex/telegram.ts:164` — `bot.on("message:text", ...)`
- Korean detection: `/[\uAC00-\uD7AF]+/` (first contiguous match only)
- Hanja filter helper: `hanjaOnly()` at `convex/telegram.ts:19` (range
  `U+4E00`–`U+9FFF`)
- Word lookup flow: `getCached()` → `searchFromApi()` → `findExactMatch()`
  (`convex/telegram.ts:9`)
- Hanja DB lookup: `lookupHanja()` backed by `internal.hanja.getByCharacters`
  (`convex/hanja.ts:29`)
- Callback handler: `convex/telegram.ts:247`, prefixes `h:`, `s:`, `ha:`
- No `/start` command handler exists.

## New routing rules

Evaluated in order against the trimmed message text:

1. **`/start` command** → reply with the usage text below.
2. **Single CJK character** (length 1, in `\u4E00`–`\u9FFF`) → call
   `lookupHanja(char)` and reply with `formatCharDetailView(doc, char)`
   (`convex/telegram.ts:100`). If no doc is found, reply `"No Hanja entry for
   X."`.
3. **Multiple CJK characters** (length ≥ 2, all in `\u4E00`–`\u9FFF`) → reply:
   `"Please send one Hanja character at a time."` No breakdown / reconstruction
   for now.
4. **Single Hangul syllable** (length 1, in `\uAC00`–`\uD7AF`) → reply with a
   disambiguation prompt and an inline keyboard of two buttons in one row:
   - `Look up word` → callback `wq:<syllable>`
   - `Hanja for <syllable>` → callback `hh:<syllable>`

   Prompt text suggestion:
   > `"장"` can mean a Korean word or share its reading with several Hanja.
   > What do you want?
5. **Multi-syllable Hangul word** (≥ 2 Hangul chars, may be embedded in other
   text — keep the current regex extraction) → existing word lookup flow
   unchanged.
6. **Anything else** (no Hangul, no Hanja) → fall back to the same usage
   message used for `/start`.

## `/start` reply text

Keep the current wording and add examples:

```
Send me a Korean word and I'll look it up in the dictionary.

Examples:
• 학생 — Korean word
• 장 — single syllable (I'll ask what you want)
• 學 — Hanja character
```

The same text is used as the fallback for unrecognized input (rule 6).

## New callback prefixes

Add to `bot.on("callback_query:data")` in `convex/telegram.ts:247`:

- **`wq:<word>`** — force a krdict word lookup. Reuses the code path of the
  current `s:` suggestion handler (`convex/telegram.ts:256`). Factor the shared
  logic into a helper such as `runWordLookup(ctx, word)` so `s:` and `wq:`
  share one implementation.
- **`hh:<hangul>`** — list every Hanja character whose `hangul` field matches
  the given syllable. Render as a list (one per line), reusing the readings
  format from `formatAllCharactersView` (`convex/telegram.ts:110`). Each
  character should also be a tappable button with callback `h:<char>` so the
  user can drill into a single Hanja via the existing `h:` handler
  (`convex/telegram.ts:251`).

If no Hanja match the syllable, reply `"No Hanja found for <syllable>."`.

## Schema / data layer changes

### `convex/schema.ts`

Add an index on the `hangul` field of the `hanja` table (around line 11):

```ts
.index("by_hangul", ["hangul"])
```

### `convex/hanja.ts`

Add a new query `getByHangul(hangul: string)` that uses the `by_hangul` index
to return all Hanja docs whose `hangul` matches. Use an indexed lookup, not a
`filter()` scan.

### Data normalization note

`kHangul` values from Unihan (see `scripts/seedHanja.ts`) often include
suffixes like `장:0E`. The seed script already strips them, so the stored
`hangul` field is the bare syllable. No further normalization is required at
query time.

## Files to touch during implementation

- `convex/telegram.ts` — message handler (line 164), callback handler
  (line 247), add `/start` handler and helper functions.
- `convex/schema.ts` — add `by_hangul` index (around line 11).
- `convex/hanja.ts` — add `getByHangul` query.

## Out of scope

- Changes to krdict fetch logic, caching, or response formatting helpers
  beyond what is described above.
- Multi-Hanja word reconstruction (e.g. `學生` → look up Korean word whose
  origin matches).
- Localization of new prompt strings.
