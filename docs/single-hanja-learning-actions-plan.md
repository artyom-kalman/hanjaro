# Implementation Plan: Single-Hanja Learning Actions

> Implements [`single-hanja-learning-actions-spec.md`](./single-hanja-learning-actions-spec.md).
> This plan deliberately changes no database schema, KrDict request, or callback
> contract.

## Overview

Turn a single-Hanja reply into a two-stage Telegram interaction:

```text
Hanja document ──> compact card ──> ctx.reply immediately
                                      │
                                      ▼
                         existing examples lookup (best effort)
                                      │
                                      ▼
                  edit that reply + up to 3 `wq:<word>` action buttons
```

The formatting foundation comes first so the Telegram handler can render both
the initial and upgraded states without duplicating or misplacing the AI
attribution footer. The async handler change then becomes one contained
vertical slice.

## Architecture Decisions

- **Dedicated formatter:** Add a new single-Hanja-card formatter instead of
  modifying `formatHanjaBreakdown`, because word-result messages also use the
  existing breakdown format.
- **Formatter owns final text order:** The formatter accepts an optional action
  label and appends any Hanja AI footer only after that label. The handler
  therefore cannot accidentally put `✨ Translated with AI` in the middle of
  the upgraded message or append it twice.
- **Existing callback contract:** Buttons use the already-supported `wq:<word>`
  callback, so no schema, callback branch, or state store is required.
- **Best-effort upgrade:** `lookupHanjaExamples` already converts its own
  failures and timeouts to `[]`; the only new failure point is Telegram’s edit,
  which is caught and logged locally.
- **One button per row:** Reuse the established `InlineKeyboard().text(...).row()`
  pattern. Limit output to three entries and cap visible label length while
  retaining the full word in callback data.

## Dependency Graph

```text
localized action label ─┐
compact card formatter ─┼──> formatter unit tests ──> async Telegram upgrade
AI footer ordering ─────┘                                      │
existing wq callback ──────────────────────────────────────────┘
```

Tasks are sequential: Task 2 consumes the formatter and localization contract
created in Task 1. There is no useful parallel implementation path without
duplicating that contract.

## Task List

### Phase 1: Formatting foundation

## Task 1: Add the compact card and localized action copy

**Description:** Add a pure `formatSingleHanjaCard` helper for the initial and
upgraded message states. It renders character, available readings, and localized
meanings as compact lines; it optionally adds the action-section heading and
places any Hanja AI footer last. Add the EN/RU action label and focused unit
coverage.

**Acceptance criteria:**

- [ ] A Hanja document with both readings renders character, `hangul · mandarin`,
  and italicized meanings on separate compact lines.
- [ ] Missing readings do not leave extra separators; missing meanings use the
  existing localized no-data fallback.
- [ ] Supplying the action label adds it before, never after, the AI footer;
  no AI footer is duplicated.
- [ ] The new action label is available through `t("en")` and `t("ru")`.

**Verification:**

- [ ] Add/extend formatter assertions in `convex/hanjaFormat.test.ts`.
- [ ] Run `bun test`.

**Dependencies:** None.

**Files likely touched:**

- `convex/hanjaFormat.ts`
- `convex/hanjaFormat.test.ts`
- `convex/i18n.ts`

**Estimated scope:** Small (3 files).

## Task 2: Send immediately and upgrade with word actions

**Description:** Replace the current single-Hanja sequence—fetch examples,
format a text list, reply—with an immediate compact-card reply followed by an
optional, in-place Telegram upgrade. Build a three-row keyboard whose labels use
the existing best-meaning selection and whose callbacks reuse `wq:<word>`.

**Acceptance criteria:**

- [ ] `handleSingleHanja` replies with the compact card before awaiting
  `lookupHanjaExamples`.
- [ ] Successful examples upgrade the sent bot reply with the localized action
  label and no more than three one-row buttons; labels are visibly shortened
  when necessary while callback data remains the full word.
- [ ] Empty, timed-out, or failed example lookups leave the initial reply
  untouched; a Telegram edit failure is logged and creates no second reply.

**Verification:**

- [ ] Run `bun test`.
- [ ] Run `bun run dev`, register the development webhook when needed with
  `bun run register:dev`, and send `學`.
- [ ] Confirm card-first behavior, the in-place button upgrade, and a working
  button lookup in both EN and RU.

**Dependencies:** Task 1.

**Files likely touched:**

- `convex/telegram.ts`

**Estimated scope:** Small (1 file).

### Checkpoint: Complete feature slice

- [ ] `bun test` passes.
- [ ] A slow or failed examples lookup leaves an immediate, useful card.
- [ ] A successful lookup upgrades the same reply, not the incoming user
  message or a new bot reply.
- [ ] Word-result and Hangul-list formatting remain unchanged.
- [ ] Human reviews the live Telegram behaviour before calling the feature done.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| An AI footer moves above the action heading after the edit | Medium | Keep footer placement in the single pure card formatter and cover both message states in tests. |
| Long fallback definitions make buttons crowded | Medium | Cap the visual label and use an ellipsis; callback data keeps the complete Korean word. |
| Telegram edit fails after the initial reply | Low | Catch/log only the optional edit; leave the original card intact. |
| The examples service is slow | Low | Reply before lookup; retain the current five-second timeout. |
| Refactoring changes word-result formatting | Medium | Do not change `formatHanjaBreakdown`; rely on existing tests plus manual regression checks. |

## Open Questions

None. The task breakdown is ready for implementation once approved.
