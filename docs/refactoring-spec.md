# Spec: Internal Refactoring — Structure, Dedup, Testability

## Objective

Restructure the bot's internals without changing behavior. Four items, ordered by impact:

1. **Dismantle the `telegram.ts` mega-closure.** Today every helper (~20 functions: keyboards, lookup flow, formatting glue, scheduling) is defined inside `handleTelegramWebhook`, rebuilt per HTTP request, and untestable. Split into focused modules; `telegram.ts` becomes routing + handler wiring.
2. **Unify the "what needs translation" decision.** The same business decision is computed twice — in `scheduleTranslationUpgrade` (telegram.ts) and `scheduledTranslateAndEdit` (translate.ts) — and has already diverged: the orchestrator's `case1MakesDefinition` rule is missing on the webhook side. Extract one pure function both callers use.
3. **Deduplicate LLM response parsing.** Fence-stripping + `JSON.parse` + shape-narrowing exists three times (`parseResponse` in translate.ts, `parseWordResponse` / `parseDefinitionResponse` in wordPrompt.ts). Replace with one generic zod-based helper; each response shape becomes a zod schema. This puts the already-declared (but unused) `zod` dependency to work.
4. **Consolidate Hanja/Hangul character utilities.** `isHanja` / `isHangul` / `allHanja` / `hanjaOnly` live in telegram.ts while translate.ts re-inlines the same `一`–`鿿` range check; the `presentHanja → hanjaContext` mapping is repeated verbatim twice in translate.ts. One small `chars.ts` module.

Success looks like: identical user-visible behavior, `telegram.ts` under ~200 lines of routing, every extracted decision/parsing/char helper covered by unit tests, zero copies of previously duplicated logic remaining.

### Non-goals

- Item 5 from the analysis (`getExamplesForCharacters` full table scan) — separate perf change, not this refactor.
- Any prompt-text, message-format, or schema changes.
- New features or new dependencies.

## Tech Stack

- Runtime: Convex (actions/queries/mutations), TypeScript 5, `"type": "module"`.
- Bot: grammy 1.x. LLM: openai SDK pointed at OpenRouter. Parsing: fast-xml-parser (KrDict), **zod 4** (newly used by this refactor).
- Tooling: bun / bunx (never npm/npx).

## Commands

```
Dev:        bun run dev            # bunx convex dev (typechecks + pushes)
Test:       bun test               # runs convex/*.test.ts via bun:test
Typecheck:  bunx tsc --noEmit
Deploy:     bun run deploy         # NOT part of this refactor's loop
```

## Project Structure

Convex requires all backend files in `convex/` (flat layout kept). Target state:

```
convex/
  telegram.ts          → SHRINKS: httpAction, bot command/message/callback routing only
  keyboards.ts         → NEW: pure InlineKeyboard builders (meaning, syllable, settings, paging)
  lookup.ts            → NEW: word-lookup flow helpers (resolveWord, searchFromApi glue,
                          findExactMatches, sendOrEdit, startSpinner, krdictToDisplay)
  translationNeeds.ts  → NEW: pure computeTranslationNeeds(word, hanjaDocs, lang) — the
                          single decision both webhook and orchestrator consume
  chars.ts             → NEW: isHanja, isHangul, allHanja, hanjaOnly, toHanjaContext
  llmJson.ts           → NEW: parseLlmJson(raw, zodSchema) — fence-strip + parse + validate
  translate.ts         → SHRINKS: actions keep orchestration; prompt/parse/char logic moves out
  wordPrompt.ts        → prompt builders stay; parse functions become zod schemas + thin
                          wrappers over parseLlmJson (public signatures unchanged)
  hanjaFormat.ts       → unchanged
  i18n.ts, krdict.ts, words.ts, hanja.ts, schema.ts, http.ts → unchanged
  *.test.ts            → NEW: translationNeeds.test.ts, chars.test.ts, llmJson.test.ts
docs/
  refactoring-spec.md  → this file
  refactoring-tasks.md → task breakdown (written after spec approval)
```

Module dependency rule: new modules `chars.ts`, `translationNeeds.ts`, `llmJson.ts` import nothing from Convex generated code or grammy — pure and unit-testable, same as `wordPrompt.ts` today. `keyboards.ts` may import grammy (`InlineKeyboard`) and `i18n.ts` only. `lookup.ts` may not import `_generated/api` directly — DB/API access is passed in as functions from `telegram.ts`.

## Code Style

Match existing repo idiom — pure modules with a header comment stating why they're pure, explanatory comments only for non-obvious constraints:

```ts
// Pure, network-free decision for which AI translation calls a word needs.
// Shared by the webhook (schedule-or-not) and the orchestrator (which calls
// to run), so the two can never diverge again.
export type TranslationNeeds = {
  missingRuHanja: NonNullable<HanjaDoc>[]; // RU only; EN glosses are native Unihan
  wordNeedsTranslation: boolean;
  definitionNeeded: boolean; // false when Prompt A (case 1) will emit one anyway
};

export function computeTranslationNeeds(
  word: WordLike,
  hanjaDocs: HanjaDoc[],
  lang: Lang,
): TranslationNeeds { /* … */ }
```

Conventions: named exports only; `type` imports with `import type`; `.js` extension on relative imports; no classes; zod schemas named `<thing>Schema`.

## Testing Strategy

- Framework: `bun:test` (`describe` / `test` / `expect`), colocated `convex/<module>.test.ts` — same as `wordPrompt.test.ts` / `hanjaFormat.test.ts`.
- New tests required for: `translationNeeds.ts` (every branch, incl. the `case1MakesDefinition` interaction), `chars.ts` (boundary code points), `llmJson.ts` (fences, malformed JSON, schema rejection).
- Existing tests are the behavioral safety net: `wordPrompt.test.ts` must pass unchanged — the zod rewrite of `parseWordResponse` / `parseDefinitionResponse` keeps their public signatures and null-return semantics exactly.
- `keyboards.ts` / `lookup.ts`: extraction only, no new tests required this pass (grammy-coupled; covered by manual verification).
- Manual verification after each phase: `bunx tsc --noEmit` + `bun test`, then a dev-deployment smoke test of the main flows (word lookup, single Hanja, syllable choice, settings, AI upgrade edit).

## Boundaries

- **Always:** run `bun test` + `bunx tsc --noEmit` after every task; keep public Convex function names/args unchanged (`internal.*` references and scheduled-action args must stay compatible — in-flight scheduled jobs may fire mid-deploy); keep prompt strings byte-identical.
- **Ask first:** any behavior change beyond the sanctioned item-2 unification; touching `schema.ts`; adding/removing dependencies; changing message formatting.
- **Never:** deploy to prod as part of this work; change `wordPrompt.test.ts` expectations to make refactored code pass; commit without being asked.

## Success Criteria

1. `handleTelegramWebhook` contains no function declarations besides handler registrations; `telegram.ts` ≤ ~200 lines.
2. `computeTranslationNeeds` is the only place the schedule/translate decision exists; webhook and orchestrator both call it. Net behavior change (intended): the webhook no longer schedules a job for words where the only "need" was a definition that Prompt A would produce anyway — currently it schedules and the orchestrator no-ops... verify the orchestrator's `attempted` logic still matches.
3. Exactly one fence-strip + parse implementation (`llmJson.ts`); `grep -r '```' convex --include='*.ts'`-style duplication check shows the strip regex in one file only. zod imported and used; the three legacy parse paths delegate to it.
4. Character-range predicates exist only in `chars.ts`; `hanjaContext` mapping exists only in `chars.ts` (`toHanjaContext`).
5. `bun test` green (old + new tests), `bunx tsc --noEmit` clean.
6. Smoke test on dev deployment: word with Hanja, word without translation (AI upgrade edits message), single Hanja char, Hangul syllable page + paging buttons, /settings language switch — all behave as before.

## Open Questions

1. **Item-2 unification direction confirmed?** Webhook adopts the orchestrator's stricter `case1MakesDefinition` rule (skips scheduling when nothing will actually run). Alternative — keep webhook permissive and let the orchestrator no-op — preserves today's exact scheduling volume but keeps two rule sets. Spec assumes the former.
2. **`lookup.ts` dependency style:** spec says pass `actionCtx`-backed functions in from `telegram.ts` (keeps lookup.ts pure-ish). If that plumbing gets awkward in practice, fallback is letting `lookup.ts` import `_generated/api` — decide at implementation, flag in PR.
