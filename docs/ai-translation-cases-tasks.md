# Implementation Plan: AI Translation — Description-Grounded Gloss & Korean Definition

Spec: [`ai-translation-cases-spec.md`](./ai-translation-cases-spec.md)

## Overview

The AI word-upgrade fires whenever the target-language **gloss** (`transWord`) is
empty. Today it always runs one prompt (word + Hanja grounding) and produces a
gloss + target description, but never a Korean definition. This plan makes the
upgrade **branch on the KrDict data already present** so it (a) grounds the gloss
on a description when one exists, and (b) generates a Korean definition when KrDict
gave none — filling **only** the missing fields.

## The condition table (drives everything)

The word action is only invoked when `transWord` is empty. Given that, the two
remaining KrDict fields decide the path:

| Korean `definition` | target `transDfn` | Case | Prompt | AI generates | Preserved untouched |
|---|---|---|---|---|---|
| empty | empty | **1** | **A** (word + Hanja) | `transWord` + `transDfn` + **Korean `definition`** | — |
| present | (any) | **2** | **B** (grounded on Korean `definition`) | `transWord` only | `definition`, `transDfn` |
| empty | present | **2** | **B** (grounded on `transDfn`) | `transWord` only | `transDfn` (Korean `definition` stays empty — known limitation) |

Selection rule: `hasDescription = definition !== "" || transDfn !== ""`.
`case 2` if `hasDescription`, else `case 1`. In case 2, ground Prompt B on the
Korean `definition` if present, else on `transDfn`.

Motivating examples: `혼혈` → row 1 (case 1); `유가` → row 2 (case 2).

## Architecture Decisions

- **One action, internal branch.** `translateWordToLang` keeps its single entry
  point and chooses Prompt A vs B from the condition table. Avoids a second
  scheduled action and keeps the single-`editMessageText` invariant intact.
- **Case 2 preserves `transDfn` by pass-through.** The orchestrator already holds
  the word; it passes the existing `transDfn` into the action, which writes it back
  unchanged alongside the new AI gloss. So the persist mutation needs no special
  "preserve" logic for `transDfn` — only an **optional `definition`** arg for case 1.
- **No schema change.** Korean definition reuses `words.definition`; footer rides
  on the existing `translations[lang].source: "ai"` marker.
- **Pure helpers stay pure.** All prompt/parse logic lands in `wordPrompt.ts`
  (no Convex/OpenAI imports) so it is unit-tested without network or DB.

## Task List

### Phase 1: Pure helpers (foundation)

#### Task 1: Prompt builders + parser for both cases
**Description:** In `convex/wordPrompt.ts`, extend Prompt A to also request a
Korean `definition`, add a new Prompt B builder grounded on a description, and
extend the parser to surface an optional `definition`. Cover all of it with unit
tests. Pure functions only — no Convex/OpenAI imports.

**Acceptance criteria:**
- [ ] `buildWordPrompt` (Prompt A) asks for `{"definition","transWord","transDfn"}`
  and instructs a short Korean-language definition (한국어 뜻풀이); Hanja block still
  omitted for pure-Korean words.
- [ ] New `buildGlossFromDescriptionPrompt` (Prompt B) takes the word + a
  description string + optional Hanja/POS and asks for `{"transWord"}` only,
  a gloss (one word / short phrase, not a sentence).
- [ ] Parser returns `{ transWord, transDfn, definition? }`; still requires a
  non-empty `transWord`; tolerates ```json fences; `definition` present only when
  the model returned a non-empty one.

**Verification:**
- [ ] `bun test` passes new cases in `convex/wordPrompt.test.ts`.

**Dependencies:** None.
**Files likely touched:** `convex/wordPrompt.ts`, `convex/wordPrompt.test.ts`.
**Estimated scope:** S (2 files).

### Phase 2: Persistence

#### Task 2: Optional Korean definition in the persist mutation
**Description:** Extend `internal.words.saveAiWordTranslation` to accept an
optional `definition` and patch `words.definition` when provided and the existing
value is empty (never overwrite a real KrDict Korean definition). `transWord` /
`transDfn` / `source: "ai"` behavior unchanged.

**Acceptance criteria:**
- [ ] New optional `definition: v.optional(v.string())` arg.
- [ ] When `definition` is a non-empty string AND the row's `definition` is empty,
  patch `words.definition`; otherwise leave it.
- [ ] `translations[lang] = { transWord, transDfn, source: "ai" }` as today; other
  language preserved via spread.

**Verification:**
- [ ] Type-checks; `bunx convex run words:saveAiWordTranslation` (or via the
  action in Task 3) writes the expected row — checked manually in Phase 3.

**Dependencies:** None (can run parallel to Task 1).
**Files likely touched:** `convex/words.ts`.
**Estimated scope:** XS (1 file).

### Phase 3: Wire the branch into the action

#### Task 3: Branch `translateWordToLang` on the condition table
**Description:** Make `translateWordToLang` choose Prompt A vs B from the condition
table, parse the matching shape, and persist only the missing fields. The
orchestrator (`scheduledTranslateAndEdit`) passes the existing `transDfn` so case 2
can preserve it.

**Acceptance criteria:**
- [ ] Action gains a `transDfn: v.string()` arg; orchestrator passes
  `word.translations[lang]?.transDfn ?? ""`.
- [ ] `hasDescription = definition !== "" || transDfn !== ""` selects the case.
- [ ] **Case 1:** Prompt A → persist `transWord` + AI `transDfn` + (if KrDict
  `definition` was empty) the generated Korean `definition`.
- [ ] **Case 2:** Prompt B (grounded on `definition` else `transDfn`) → persist
  `transWord` only, passing the existing `transDfn` through unchanged; do not send
  a `definition`.
- [ ] Empty/failed response → `{ translated: false }`, message untouched (unchanged
  failure path).

**Verification:**
- [ ] `bun test` still green; type-checks.
- [ ] Manual (Phase-3 checkpoint below).

**Dependencies:** Task 1, Task 2.
**Files likely touched:** `convex/translate.ts`.
**Estimated scope:** S (1 file).

### Checkpoint: end-to-end (manual via live bot / `bunx convex dev`)
- [ ] **Case 2 — `유가` (ru):** card upgrades to a `🇷🇺` gloss; KrDict Korean
  definition `석유의 가격.` and Russian `Стоимость нефти.` unchanged; footer shows.
- [ ] **Case 1 — `혼혈` (ru), fresh row:** gloss + Russian description + Korean
  definition line all appear; footer shows. (Clear the cached row first so case 1
  re-runs.)
- [ ] **No overwrite:** a fully-KrDict-translated word shows KrDict data, no footer.
- [ ] **Caching:** second lookup of an upgraded word is instant, footer + Korean
  definition still present.
- [ ] Review with human.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prompt B returns a full sentence instead of a gloss | Med | Prompt explicitly demands "one word / short phrase, the gloss only"; parser trims; manual check on `유가`. |
| Case 2 accidentally blanks KrDict `transDfn` | High | Action passes existing `transDfn` through; checkpoint verifies it is byte-for-byte unchanged. |
| AI overwrites a real KrDict Korean definition | High | Mutation patches `definition` only when the row's value is empty. |
| Mixed source: AI gloss + KrDict `transDfn` both marked `ai` | Low | Accepted in spec — `source: "ai"` means "AI involved", footer stays honest. |

## Open Questions

- Backfill pre-existing case-1 rows (current `혼혈`) with a Korean definition, or
  let cache refresh naturally? (Spec recommends: no backfill.)
