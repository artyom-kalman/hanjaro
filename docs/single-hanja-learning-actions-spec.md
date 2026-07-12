# Spec: Single-Hanja Learning Actions

## Objective

Replace the crowded, text-heavy reply for a **single Hanja character** with a
character-first Telegram message that leads naturally into word learning.

A learner who sends `學` should receive an immediate, compact reference card:

```text
學
학 · xué
study · learning · school
```

When example lookup finishes, the **same message** gains a localized
`Learn it in a word` section label and up to three inline buttons, for example:

```text
Learn it in a word

[ 학생 · student ]
[ 학교 · school ]
[ 학문 · learning ]
```

Each button runs the existing word-lookup flow for that Korean word. The full
word result continues to show its Hanja origin and definition as it does today.

### Why

The current reply gives the character, every meaning, readings, and up to five
examples equal visual weight. The new reply makes the character the clear
subject and treats example words as optional next steps.

### Decisions (validated)

| Decision | Choice |
| --- | --- |
| Scope | Change only single-Hanja lookups. Word-result cards and Hangul Hanja lists are unchanged. |
| Initial response | Send the character card immediately; do not await examples. |
| Examples | Fetch asynchronously after the first reply and show at most three actions. |
| Failure/timeout | Keep the initial card unchanged. Do not add an error or a loading state. |
| Action destination | Reuse the existing `wq:<word>` callback and word-lookup flow. |
| Action labels | `Hangul · best available meaning`, preferring the user's-language translated gloss. |
| New copy | Add a localized `Learn it in a word` label. |
| Data/dependencies | No schema change and no new dependency. |

## Behaviour

### 1. Initial card (synchronous)

For a valid single Hanja character, `handleSingleHanja` must:

1. Look up the Hanja document, as it does today.
2. Render and reply with the compact card immediately.
3. Preserve the existing localized no-entry response when there is no Hanja
   document.

The compact card contains, in this order:

1. The character as the prominent line (`<b>學</b>`).
2. Available readings on one muted line: Hangul, then Mandarin, separated by
   ` · `. Omit absent readings and the separator around them.
3. The localized meanings as one italicized line, separated by ` · `.

If an entry has no meanings, retain the current localized `no data` fallback.
If its rendered Hanja meanings are AI-translated (RU only), retain the existing
AI attribution footer exactly once.

### 2. Examples upgrade (asynchronous)

After sending the card, start the existing `lookupHanjaExamples(character, lang)`
request. Its current five-second timeout remains in force.

- **Do not** delay `ctx.reply` for this request.
- If it returns no usable examples, timeouts, or fails, leave the sent message
  untouched. The helper continues to log the failure internally.
- If it returns examples, take the first three and edit the **bot reply** using
  `ctx.api.editMessageText`, not the incoming user message.
- The edited text is the same card plus two newlines and the localized bold
  action label. Its `reply_markup` is the action keyboard described below.
- Re-evaluate/append the existing AI footer when formatting the edited text so
  it remains the final line of the message, after the action label.
- If Telegram rejects the edit (for example, a deleted message), log the error
  and complete the webhook normally. A failed optional upgrade must not produce
  a second user-facing response.

The initial message does not include an empty `Learn it in a word` label or a
loading indicator. This avoids a dangling section when no examples are found.

### 3. Inline action keyboard

Render a maximum of three examples as one full-width inline button per row.
The label has this shape:

```text
학생 · student
```

Meaning selection uses the existing compact-display order:

1. The selected-language translated word (`transWord`).
2. Its translated definition (`transDfn`) if the gloss is unavailable.
3. The Korean definition as a final fallback.

The callback data is `wq:<word>`. The existing callback handler already maps
this to `runWordLookup`; no new callback branch or persistent state is needed.

Button label text must be bounded to a short Telegram-friendly length before
building the keyboard (including an ellipsis when truncated), while callback
data always retains the complete Korean word. This prevents unusually long
definitions from recreating the crowded layout in button form.

### 4. Out of scope

- Changing the rendering of multi-character Hanja word results.
- Changing Hanja lists reached through a single Hangul syllable.
- An `Examples`/`Back` expandable state, pagination, or a fourth action.
- Persisting single-Hanja examples beyond the existing word-cache write.
- Changing the KrDict query, its five-second timeout, or the AI translation
  pipeline.

## Tech Stack

- TypeScript, Bun, and Convex.
- Telegram webhook and inline keyboards through `grammy`.
- Existing KrDict example lookup and Convex word cache.
- No new packages, database tables, indexes, or migrations.

## Commands

```bash
# Run the unit suite
bun test

# Run the Convex development environment for manual Telegram testing
bun run dev

# Register the development webhook when required by the local workflow
bun run register:dev
```

## Project Structure

```text
convex/hanjaFormat.ts       → Pure HTML message-formatting helpers
convex/hanjaFormat.test.ts  → Formatting and edge-case unit tests
convex/i18n.ts              → English/Russian UI copy
convex/telegram.ts          → Single-Hanja handler, example fetch, keyboard, callbacks
docs/                       → Feature specifications
```

Expected code changes are limited to:

- `convex/hanjaFormat.ts` — add a dedicated compact single-Hanja card formatter;
  do not alter `formatHanjaBreakdown`, which is also used by word results.
- `convex/i18n.ts` — add the EN/RU `Learn it in a word` UI string.
- `convex/telegram.ts` — send the card before fetching examples, build the
  three-row action keyboard, and safely edit the reply when examples arrive.
- `convex/hanjaFormat.test.ts` — cover the new pure formatting helper and its
  important fallbacks.

## Code Style

Keep formatters pure and transport-free, and keep Telegram effects in the
webhook handler. Follow the existing project’s named helper style:

```ts
const examples = await lookupHanjaExamples(char, lang);
if (examples.length === 0) return;

await ctx.api.editMessageText(chatId, messageId, updatedText, {
  parse_mode: "HTML",
  reply_markup: buildHanjaWordKeyboard(examples.slice(0, 3), lang),
});
```

- Use `Lang` and `t(lang)` for every user-visible string.
- Escape user/data-derived HTML through the existing formatter helpers.
- Keep the callback payload format as `wq:<word>`; do not introduce stateful
  callback records or new database data.
- Treat the example upgrade as best-effort: catch and log edit errors locally.

## Testing Strategy

### Automated

Run `bun test`.

Add/extend `convex/hanjaFormat.test.ts` to verify that the compact formatter:

- puts the character first, readings on one line, and meanings on one line;
- omits missing Hangul/Mandarin readings without malformed separators;
- uses localized Hanja meanings (including RU values); and
- preserves the no-data fallback.

Keep existing formatter tests passing, proving that word-result and Hanja-list
formats were not changed accidentally.

### Manual Telegram checks

With the development webhook registered:

1. Send a known Hanja such as `學`. The compact card appears before the example
   lookup resolves.
2. Once examples resolve, that same message has at most three one-row buttons
   and the localized action label.
3. Tap a button. The existing word lookup returns the ordinary full word card.
4. Simulate/observe an example timeout or lookup failure. The card remains and
   no error or empty action heading appears.
5. Repeat in English and Russian. Labels, meaning selection, and AI footer use
   the active language.
6. Verify a word lookup and a single-Hangul Hanja list still render as before.

## Boundaries

### Always

- Run `bun test` before proposing the implementation as complete.
- Preserve immediate single-Hanja reply behaviour even when KrDict is slow.
- Limit actions to three and use the existing `wq:` callback path.
- Keep optional-upgrade failures non-fatal and logged.

### Ask first

- Changing the five-second example timeout or KrDict request parameters.
- Adding a database cache/index or a new persistent callback state.
- Adding dependencies or changing the deployed webhook workflow.

### Never

- Delay the initial card until examples return.
- Show an error, spinner, or empty `Learn it in a word` section for an optional
  examples failure.
- Change unrelated word-result or Hangul-list formats as part of this feature.
- Commit Telegram tokens, API keys, or other secrets.

## Success Criteria

- A single-Hanja lookup sends a compact card without waiting for the KrDict
  examples request.
- A successful examples request upgrades only that bot message with no more
  than three translated-word action buttons.
- Each action opens the existing corresponding word lookup.
- Failed, empty, or timed-out example requests leave the initial message
  intact and do not create another reply.
- Existing Hanja AI-footer attribution remains correct and appears no more than
  once.
- EN and RU labels are localized.
- `bun test` passes, including new compact-card coverage.

## Open Questions

None. The validated decisions above are sufficient to begin the planning phase.
