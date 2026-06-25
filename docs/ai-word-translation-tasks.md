# Implementation Plan: AI Word-Level Translation

Companion to [`ai-word-translation-spec.md`](./ai-word-translation-spec.md). Build order, tasks, acceptance + verification.

## Overview

Add LLM word-level translation (gloss + definition) for both `en` and `ru` when KrDict has no `transWord` in the user's language. Result is cached with a `source: "ai"` marker, surfaced via an automatic in-place message edit, and stamped with the existing AI footer. The existing Hanja *char-gloss* AI translation (RU-only) is unchanged in behavior but folded under a shared, language-aware background orchestrator.

## Architecture Decisions

- **Shared renderer must move to `hanjaFormat.ts`.** The background action (`translate.ts`) cannot import the webhook module (`telegram.ts`), but it must re-render the full message to inject the new word translation (today the rendered `prefix` is frozen at schedule time and a new word line could never appear). So `formatSearchResult` + its `DisplayResult`/`Translation`/`pickTranslation`/`LANG_FLAG` deps move into the shared formatting module, and both the webhook and the action render through one `formatWordResult(...)`.
- **One orchestrator, one message edit.** "Separate LLM calls" (char + word) run under a single scheduled action that performs exactly one `editMessageText` — avoids two background actions racing on the same message.
- **Char translation stays RU-only.** English Hanja glosses are native Unihan; only the word call runs for English.
- **Single source-aware footer.** Footer appears once when `(any Hanja gloss is AI)` OR `(word translation source === "ai")`. `source` prevents stamping "AI" on real KrDict text.
- **Pure helpers isolated** in `convex/wordPrompt.ts` (no Convex/OpenAI imports) so they're trivially unit-testable.

## Dependency Graph

```
T1 schema + persist mutation
   └── T2 wordPrompt.ts + translateWordToLang action
            │
T3 renderer consolidation + source-aware footer + i18n rename   (independent of T1/T2)
            │
            └── T4 orchestrator (lang-aware) + telegram wiring     (needs T2 + T3)
                     │
                     └── T5 tests (needs T2 helpers + T3 footer helper)
```

---

## Task List

### Phase 1: Foundation (data + LLM, verifiable in isolation)

#### Task 1: Schema `source` marker + persist mutation

**Description:** Add an optional `source: "krdict" | "ai"` to each per-language object in `words.translations`, and a mutation to write an AI word translation for a given `targetCode` + `lang`, preserving the other language.

**Acceptance criteria:**
- [ ] `words.translations.{en,ru}` accept an optional `source` literal union; existing rows (no `source`) still validate — no migration.
- [ ] `saveAiWordTranslation(targetCode, lang, transWord, transDfn)` patches `translations[lang] = { transWord, transDfn, source: "ai" }`, spreading existing `translations` so the other language survives.
- [ ] No-op (returns) if the word doc is missing.

**Verification:**
- [ ] `bunx convex dev` pushes schema without validation errors.
- [ ] Manual: `bunx convex run words:saveAiWordTranslation '{"targetCode":<real>,"lang":"ru","transWord":"тест","transDfn":"тест-опр"}'` → inspect the row in the Convex dashboard; `source:"ai"`, other lang intact.

**Dependencies:** None
**Files:** `convex/schema.ts`, `convex/words.ts`
**Scope:** S

---

#### Task 2: Pure word-prompt helpers + `translateWordToLang` action

**Description:** New pure module `convex/wordPrompt.ts` with `buildWordPrompt(input, lang)` and `parseWordResponse(raw)`. New `translateWordToLang` internal action in `translate.ts` that reuses the existing OpenRouter client + `TIMEOUT_MS`/`MAX_RETRIES`/model, calls the LLM in JSON mode, and persists via `saveAiWordTranslation`.

**Acceptance criteria:**
- [ ] `buildWordPrompt` interpolates target language ("English"/"Russian"), includes word, POS, Korean definition, and (for Hanja words) each Hanja char + its English meanings; omits the Hanja block when there are none.
- [ ] `parseWordResponse` strips ` ```json ` fences, parses `{transWord, transDfn}`, trims; returns `null`/failure when `transWord` is empty.
- [ ] `translateWordToLang({ targetCode, lang, word, origin, pos, definition, hanjaContext })` returns `{ translated: boolean }`; on success the row gains `translations[lang].source === "ai"`.
- [ ] Missing `OPENROUTER_API_KEY` or any error → logs + returns `{ translated: false }` (never throws to caller).

**Verification:**
- [ ] Typecheck clean via `bunx convex dev`.
- [ ] Manual: pick a real `targetCode` with no RU `transWord`, `bunx convex run translate:translateWordToLang '{...}'` → `{translated:true}` and DB row populated. (If `convex run` cannot invoke an `internalAction`, defer this to the Task 4 end-to-end check — see Open Questions.)

**Dependencies:** Task 1
**Files:** `convex/wordPrompt.ts` (new), `convex/translate.ts`
**Scope:** M

---

### Checkpoint A — Foundation
- [ ] Schema pushed; `saveAiWordTranslation` and `translateWordToLang` populate `source:"ai"` for a real word; `en`/`ru` coexist.

---

### Phase 2: Rendering + Integration

#### Task 3: Consolidate renderer + source-aware single footer + i18n rename

**Description:** Move the word renderer into the shared formatting module so the background action can reuse it, make the AI footer fire once based on Hanja-AI **or** word-AI source, and rename the failure string to a generic one. Pure refactor — **no behavior change** until Task 4.

**Acceptance criteria:**
- [ ] `DisplayResult`, `Translation` (now with optional `source`), `pickTranslation`, `LANG_FLAG`, and `formatSearchResult` live in `hanjaFormat.ts`; `telegram.ts` imports them.
- [ ] New `formatWordResult(result, hanjaDocs, chars, lang)` renders header + breakdown + a single footer; footer shown when `hanjaGlossesAreAi(docs, lang)` OR `result.translations[lang]?.source === "ai"`.
- [ ] `formatHanjaBreakdown` no longer auto-appends the footer; `handleSingleHanja` and `formatHangulHanjaPage` append it via the shared helper (Hanja-AI only there).
- [ ] `i18n.ts`: `hanjaTranslateFailed` renamed to `aiTranslateFailed` (both `en`/`ru`); all usages updated.
- [ ] Existing RU char-gloss footer and EN flows render **identically** to before.

**Verification:**
- [ ] `bunx convex dev` typechecks clean.
- [ ] Manual: a RU Hanja word still shows the `✨ Перевод с помощью ИИ` footer for AI char glosses; EN lookup unchanged; single-Hanja and Hangul→Hanja list still footer correctly.

**Dependencies:** None (can run parallel to T1/T2; needs `source` field name agreed in T1)
**Files:** `convex/hanjaFormat.ts`, `convex/telegram.ts`, `convex/i18n.ts`, `convex/translate.ts` (rename usage)
**Scope:** M (mechanical moves + small footer logic)

---

#### Task 4: Language-aware orchestrator + telegram wiring

**Description:** Generalize `scheduledTranslateAndEdit` into a self-contained, language-aware orchestrator keyed by `targetCode` + `lang`; run the needed char (RU-only) and word LLM calls concurrently; re-render via `formatWordResult`; perform one edit with a generic failure note. Update the bot to schedule it for both languages when a word translation (or RU char gloss) is missing.

**Acceptance criteria:**
- [ ] Orchestrator args shrink to `{ chatId, messageId, targetCode, lang }`; it re-queries the word + Hanja docs, runs `translateHanjaToRu` (only if `lang==="ru"` and chars missing RU) and `translateWordToLang` (if word missing `transWord` in `lang`) via `Promise.all`, re-renders, and edits once.
- [ ] On total failure (nothing new produced) it appends the generic `aiTranslateFailed` note; identical-text edits are swallowed.
- [ ] `scheduleRussianHanjaUpgrade` → `scheduleTranslationUpgrade`: schedules when `lang` is en/ru **and** (word missing `transWord` in `lang`, or `lang==="ru"` with a Hanja char missing its RU gloss).
- [ ] Both call sites updated: `handleWordLookup` (exact match) and the `m:` callback; the `lang==="ru"` gate is removed/replaced.

**Verification:**
- [ ] End-to-end in the dev bot:
  - `신문` (ru): breakdown-only → upgrades to RU word gloss (≈ "газета") + definition + footer.
  - `낯설다` (ru): word+POS only → upgrades to RU gloss + definition + footer.
  - an EN-missing word (en): upgrades to EN gloss + definition + `✨ Translated with AI`; breakdown stays native English.
  - a word with a real KrDict `transWord`: unchanged, no AI call, no footer.
- [ ] Exactly one final `editMessageText` per result (no flicker/double-edit).

**Dependencies:** Task 2, Task 3
**Files:** `convex/translate.ts`, `convex/telegram.ts`
**Scope:** M

---

### Checkpoint B — Core works end to end
- [ ] All three success-criteria words upgrade in place; no-overwrite case clean; single edit; EN char glosses stay native.
- [ ] Review with human before Phase 3.

---

### Phase 3: Tests

#### Task 5: Unit tests for pure helpers + `bun test` script

**Description:** Add `bun:test` coverage for the pure, network-free helpers and a `test` script.

**Acceptance criteria:**
- [ ] `buildWordPrompt`: language interpolation; Hanja block present for Hanja words, absent for pure Korean.
- [ ] `parseWordResponse`: plain JSON, ` ```json ` fenced JSON, empty `transWord` → failure, malformed JSON → failure.
- [ ] Footer-decision helper: true for Hanja-AI, true for word-AI (`source:"ai"`), false for KrDict-only.
- [ ] `package.json` has `"test": "bun test"`.

**Verification:**
- [ ] `bun test` passes.

**Dependencies:** Task 2, Task 3
**Files:** `convex/wordPrompt.test.ts` (new), `convex/hanjaFormat.test.ts` (new), `package.json`
**Scope:** S

---

### Checkpoint C — Complete
- [ ] All spec success criteria met; `bun test` green; spec + plan committed.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Moving render types to `hanjaFormat.ts` introduces import cycles | Med | Keep `hanjaFormat.ts` free of any `telegram.ts` import; dependency flows one way (telegram → hanjaFormat). |
| `bunx convex run` cannot invoke an `internalAction` | Med | Verify early in T2; if blocked, validate `translateWordToLang` via the T4 end-to-end bot check instead. |
| Footer regressions (double / missing) after de-coupling from `formatHanjaBreakdown` | Med | T5 footer-decision tests + Checkpoint B manual across all message types. |
| Telegram "message is not modified" on no-op edit | Low | Already caught/logged; optionally skip the edit when re-rendered text equals original. |
| LLM latency/cost per uncached word (automatic trigger) | Low | Cached after first lookup; reuse existing 12s timeout + 2 retries; runs in detached scheduled action. |
| Hallucinated word translation | Low/Med | Ground on Korean definition + Hanja context; clear AI footer; never overwrite KrDict. |

## Open Questions

- Confirm `bunx convex run` runs internal actions in dev (affects T2 standalone verification).
- Out of scope (note, not blocking): a word that *has* `transWord` but an empty `transDfn` won't get its definition AI-filled — trigger keys on `transWord` only.
