# Implementation Plan: Internal Refactoring (items 1–4)

Spec: [refactoring-spec.md](./refactoring-spec.md)

## Overview

Four-phase refactor, foundation-first: pure utility modules go in before anything consumes them, the shared translation-needs decision lands mid-way (the only sanctioned behavior change, so it gets its own checkpoint), and the telegram.ts split comes last because it depends on everything else already existing. Every task leaves the repo compiling and green.

## Architecture Decisions

- **Char-gloss prompt/parse (`buildPrompt` / `parseResponse` in translate.ts) moves into `wordPrompt.ts`.** The spec says this logic leaves translate.ts; wordPrompt.ts is the established pure prompt module, so it becomes the single home for all prompt building/parsing rather than spawning a fourth prompt file. Its header comment is updated accordingly.
- **`parseLlmJson` returns `null` on any failure** (malformed JSON, fence garbage, schema rejection) — matching the existing "null means unusable, caller degrades gracefully" convention, so callers don't change shape.
- **`computeTranslationNeeds` takes plain data** (`{ definition, translations }`-shaped word, `HanjaDoc[]`, `Lang`) and returns `{ missingRuHanja, wordNeedsTranslation, definitionNeeded }`. The webhook derives "schedule or not" as `missingRuHanja.length > 0 || wordNeedsTranslation || definitionNeeded`; the orchestrator's `attempted` flag is the same expression — one rule set.
- **`lookup.ts` gets its Convex/API access injected** as plain async functions from telegram.ts (spec open question 2; fallback to direct `_generated/api` import allowed if plumbing turns awkward — flag it if taken).
- **Scheduled-action compatibility:** no `internal.*` function is renamed and `scheduledTranslateAndEdit` args are untouched, so jobs in flight during a deploy keep working.

## Task List

### Phase 1: Foundation (pure modules, no consumers yet)

## Task 1: Create `chars.ts` with tests

**Description:** New pure module with `isHanja`, `isHangul`, `allHanja`, `hanjaOnly` (moved verbatim from telegram.ts, not yet deleted there) plus `toHanjaContext(docs)` implementing the `presentHanja → { character, englishMeanings }` mapping duplicated in translate.ts.

**Acceptance criteria:**
- [ ] `chars.ts` exports the five helpers; imports nothing except types
- [ ] `chars.test.ts` covers range boundaries (U+4E00/U+9FFF, U+AC00/U+D7AF, just-outside code points), empty string, mixed strings, `toHanjaContext` with empty meanings

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** None
**Files:** `convex/chars.ts`, `convex/chars.test.ts`
**Estimated scope:** S

## Task 2: Create `llmJson.ts` with tests

**Description:** New pure module exporting `parseLlmJson<T>(raw: string, schema: ZodType<T>): T | null` — trims, strips ```` ```json ```` fences (same regexes as today), `JSON.parse`, validates with `schema.safeParse`, returns `null` on any failure. First real use of the zod dependency.

**Acceptance criteria:**
- [ ] Handles: clean JSON, fenced JSON, fenced-without-language-tag, malformed JSON, valid JSON failing schema — last two return `null`
- [ ] No Convex/grammy/openai imports

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** None
**Files:** `convex/llmJson.ts`, `convex/llmJson.test.ts`
**Estimated scope:** S

### Checkpoint: Foundation
- [ ] `bun test` green, typecheck clean, zero existing files modified

### Phase 2: Parsing dedup (item 3) + char-util adoption (item 4)

## Task 3: Rewrite wordPrompt parsers on `parseLlmJson`

**Description:** Replace the bodies of `parseWordResponse` and `parseDefinitionResponse` with zod schemas (`wordTranslationSchema`, `definitionSchema`) + `parseLlmJson`, preserving exact semantics: trim fields, empty `transWord`/`definition` ⇒ `null`, optional `definition` only included when non-empty.

**Acceptance criteria:**
- [ ] Public signatures unchanged
- [ ] `wordPrompt.test.ts` passes **without any edits** (behavioral safety net)

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** Task 2
**Files:** `convex/wordPrompt.ts`
**Estimated scope:** S

## Task 4: Move char-gloss prompt/parse out of translate.ts

**Description:** Move `buildPrompt` (renamed `buildCharGlossPrompt`) and `parseResponse` (renamed `parseCharGlossResponse`, rebuilt on `parseLlmJson` with a record-of-string-arrays schema keeping the per-char filtering/trimming) into `wordPrompt.ts`, along with the `CharInput`/`ExampleWord` types. translate.ts imports them. Prompt output stays byte-identical.

**Acceptance criteria:**
- [ ] translate.ts contains no prompt-building or JSON-parsing code
- [ ] New tests cover `buildCharGlossPrompt` (with/without examples, hangul/mandarin context) and `parseCharGlossResponse` (missing chars, non-string glosses, fences)

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** Tasks 2, 3
**Files:** `convex/wordPrompt.ts`, `convex/wordPrompt.test.ts`, `convex/translate.ts`
**Estimated scope:** M

## Task 5: Adopt `chars.ts` everywhere; delete duplicates

**Description:** translate.ts uses `hanjaOnly` (replacing the inline U+4E00–U+9FFF filter at the top of `scheduledTranslateAndEdit`) and `toHanjaContext` (replacing both verbatim mappings). telegram.ts imports `isHanja`/`isHangul`/`allHanja`/`hanjaOnly` from chars.ts and its local copies are deleted.

**Acceptance criteria:**
- [ ] Char-range predicates exist only in `chars.ts` (grep for `一` confirms)
- [ ] The `{ character, englishMeanings }` mapping exists only in `toHanjaContext`

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** Task 1
**Files:** `convex/translate.ts`, `convex/telegram.ts`
**Estimated scope:** S

### Checkpoint: Dedup complete
- [ ] `bun test` green, typecheck clean
- [ ] Fence-strip regex exists in exactly one file (`llmJson.ts`); zod in use
- [ ] Dev push (`bun run dev`) succeeds; quick lookup of one word behaves as before

### Phase 3: Decision unification (item 2 — the sanctioned behavior change)

## Task 6: Create `translationNeeds.ts` with tests

**Description:** Pure `computeTranslationNeeds(word, hanjaDocs, lang)` returning `{ missingRuHanja, wordNeedsTranslation, definitionNeeded }`, encoding the orchestrator's current rules including `case1MakesDefinition` (definition not needed when Prompt A will emit one) and RU-only hanja gloss translation. Not yet consumed.

**Acceptance criteria:**
- [ ] Tests cover every branch: en vs ru; hanja missing/present/already-translated; word translated vs not; definition present vs absent; the case-1 interaction (no gloss + no description ⇒ `definitionNeeded === false`)

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** None (types from hanjaFormat.ts)
**Files:** `convex/translationNeeds.ts`, `convex/translationNeeds.test.ts`
**Estimated scope:** M

## Task 7: Adopt `computeTranslationNeeds` in both callers

**Description:** `scheduledTranslateAndEdit` (translate.ts) derives `missingHanja` / `wordNeedsTranslation` / `definitionNeeded` / `attempted` from the shared function; `scheduleTranslationUpgrade` (telegram.ts) schedules iff any need is non-empty. Intended behavior change: the webhook stops scheduling jobs whose only "need" was a definition Prompt A produces anyway (today: schedules, orchestrator no-ops).

**Acceptance criteria:**
- [ ] Neither caller computes any need inline; grep shows the decision only in `translationNeeds.ts`
- [ ] `scheduledTranslateAndEdit` args unchanged

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean
- [ ] Dev smoke: word missing RU translation → message upgrades in place; fully-cached word → no scheduled job (check Convex dashboard logs)

**Dependencies:** Task 6
**Files:** `convex/translate.ts`, `convex/telegram.ts`
**Estimated scope:** M

### Checkpoint: Single decision rule
- [ ] Full suite green; dev smoke of AI-upgrade flow done
- [ ] **Review with human before Phase 4** (behavior change lands here)

### Phase 4: telegram.ts split (item 1)

## Task 8: Extract `keyboards.ts`

**Description:** Move the four pure keyboard builders (`buildHangulHanjaKeyboard`, `buildSyllableChoiceKeyboard`, `buildMeaningKeyboard`, `buildSettingsKeyboard`) plus the label-truncation logic to `keyboards.ts` (imports: grammy `InlineKeyboard`, i18n, hanjaFormat types only).

**Acceptance criteria:**
- [ ] telegram.ts contains no keyboard construction
- [ ] Builders are module-level exports, no closure state

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** None
**Files:** `convex/keyboards.ts`, `convex/telegram.ts`
**Estimated scope:** S

## Task 9: Extract `lookup.ts`

**Description:** Move the lookup flow — `findExactMatches`, `startSpinner`, `sendOrEdit`, `krdictToDisplay`, `searchFromApi`, `resolveWord`, `formatResultWithHanja`, `cachedHasLang` — to `lookup.ts`. DB/API access (`getCached`, `saveMany` mutation, hanja queries) is injected as functions; grammy `api` passed as a parameter (as today).

**Acceptance criteria:**
- [ ] `lookup.ts` does not import `_generated/api` (or deviation is flagged per spec open question 2)
- [ ] telegram.ts wires injections; no lookup logic remains inline

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** Tasks 5, 8
**Files:** `convex/lookup.ts`, `convex/telegram.ts`
**Estimated scope:** M

## Task 10: Slim telegram.ts to routing

**Description:** Hoist the remaining handlers (`handleWordLookup`, `handleSingleHanja`, `handleHangulHanjaList`, `scheduleTranslationUpgrade`, user-lang helpers) out of the `handleTelegramWebhook` closure to module level with explicit parameters; the httpAction body becomes bot construction + handler registration + `webhookCallback`.

**Acceptance criteria:**
- [ ] No function declarations inside `handleTelegramWebhook` besides `bot.command`/`bot.on` registrations
- [ ] telegram.ts ≤ ~200 lines

**Verification:**
- [ ] `bun test` passes, `bunx tsc --noEmit` clean

**Dependencies:** Tasks 8, 9
**Files:** `convex/telegram.ts` (possibly `convex/lookup.ts`)
**Estimated scope:** M

### Checkpoint: Complete
- [ ] All spec success criteria checked off (spec §Success Criteria 1–5)
- [ ] Dev-deploy smoke test (spec §Success Criteria 6): word with Hanja; word needing AI upgrade (message edits in place); single Hanja char; multi-Hanja warning; Hangul syllable choice + paging; suggestion buttons; /start; /settings language switch
- [ ] Ready for human review / commit

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| zod rewrite subtly changes parse semantics (trim/empty handling) | Med | `wordPrompt.test.ts` must pass unedited (Task 3 gate); new fence/rejection tests in Task 2 |
| Item-2 unification changes scheduling more than intended | Med | Branch-complete tests in Task 6; dev smoke + dashboard log check in Task 7; human checkpoint before Phase 4 |
| Mid-deploy scheduled jobs hit renamed/changed actions | High | Hard rule: `internal.*` names and `scheduledTranslateAndEdit` args frozen (all tasks) |
| `lookup.ts` dependency injection turns into awkward plumbing | Low | Sanctioned fallback: import `_generated/api` directly, flag deviation (spec OQ2) |
| Convex bundler unhappy with new non-function modules in `convex/` | Low | Same pattern as existing `wordPrompt.ts`/`hanjaFormat.ts`; caught immediately by `bun run dev` push at checkpoints |

## Parallelization

Tasks 1, 2, 6, 8 are mutually independent (parallel-safe). Task chains: 2→3→4, 1→5, 6→7, 8/9→10. Single-session sequential execution is also fine — total scope is ~10 S/M tasks.

## Open Questions

- None new. Spec OQ1 (webhook adopts stricter scheduling rule) is assumed resolved as "yes" — Task 7 implements it; object before Phase 3 starts.
