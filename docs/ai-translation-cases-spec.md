# Spec: AI Translation — Description-Grounded Gloss & Korean Definition

> Follow-up to [`ai-word-translation-spec.md`](./ai-word-translation-spec.md). That
> spec added word-level AI translation for the **"nothing from KrDict"** case.
> This spec fixes two gaps the first version left: words that get a *description*
> but no *gloss*, and words that get a *gloss* but no *Korean definition*.

## Objective

**What:** Make the AI word-translation produce a complete card by handling the
missing field precisely, with the **right prompt for the available context**:

1. **Generate the target-language gloss from the description** when KrDict gave a
   description but no gloss. (New — a *different prompt* from case 1, grounded on
   the description rather than only on word + Hanja.)
2. **Generate a Korean definition** when KrDict gave none, so the learner always
   sees the Korean-language meaning.

**Why:** After the first AI feature shipped, two broken-looking cards remain:

- **Gloss present, no Korean definition** (`혼혈 · 混血`): shows `🇷🇺 метис` + a
  Russian description, but **no Korean definition line**. This is a *case-1* word
  (KrDict gave nothing) — the case-1 AI call produced a gloss + a translated
  description but never a Korean definition.
- **Description present, no gloss** (`유가 · 油價`): shows the Korean definition
  `석유의 가격.` and its Russian translation `Стоимость нефти.`, but **no `🇷🇺`
  gloss line** — the single most important field, the word's meaning, is missing.

**Who:** Both EN and RU users (`lang === "en" | "ru"`).

**Success looks like:** Every AI-upgraded word card shows a gloss line; case-1
cards also show a Korean definition line. The right prompt is used for each
context, and only genuinely-missing fields are filled.

---

## Decisions (locked with the user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | "Korean translation" meaning | **Generate a Korean-language definition** when KrDict has none. |
| 2 | Gloss vs. Korean definition | **Independent fills.** Generate the gloss when it is missing AND generate the Korean definition when it is missing — each on its own, not coupled. |
| 3 | Missing-gloss handling | **Two prompts by available context** (case 1 / case 2 below). |
| 4 | Field scope | **Fill only the missing field(s)** — never overwrite a value KrDict (or a prior pass) already provided. |
| 5 | Footer for AI-only Korean definition | **No schema marker.** The footer shows when the gloss or Hanja glosses are AI; a *standalone* AI Korean definition (KrDict gloss, no AI Hanja) shows with no footer. Accepted. |

### The three generation cases

The upgrade ensures two things independently: a **gloss** is present and a
**Korean definition** is present. That yields three prompts:

- **Case 1 — no gloss AND no description** (already implemented; *extended* here).
  KrDict gave neither a gloss nor any definition. Prompt **A** grounds on the
  **word + Hanja** and emits gloss + target description + a **Korean definition**
  in one call. *Motivating example: `혼혈`.*
- **Case 2 — description present, no gloss** (new). KrDict gave a definition
  (Korean and/or a target-language description) but no gloss. Prompt **B** grounds
  on the **description** to produce the gloss, filling **only** the gloss.
  *Motivating example: `유가`.*
- **Case 3 — gloss present, no Korean definition** (new). The gloss already exists
  (KrDict or a prior AI pass) but the Korean definition is empty. Prompt **C**
  generates **only** the Korean definition, grounded on word + Hanja + the existing
  gloss/description. *Motivating example: `황금` (KrDict gloss `золото`, Russian
  description present, Korean definition missing).*

> Cases 2 and 3 can co-occur: a word with a target `transDfn` but neither a gloss
> nor a Korean definition runs Prompt B (gloss from `transDfn`) **and** Prompt C
> (Korean definition). Case 1 stays a single call only because nothing exists to
> ground on.

---

## Behavior

### Trigger (change)

Today the upgrade is scheduled when the target `transWord` is empty (or, RU-only,
a Hanja char lacks its gloss). Add a third condition: schedule when the Korean
`word.definition` is empty. Otherwise a word with a KrDict gloss but no Korean
definition (e.g. `황금`) would never get one — exactly the missed spot.

### Case selection (in the word-translation action)

`word.definition` is the Korean definition (a single, language-independent field on
the `words` row); `transDfn` is the target-language description. The action
evaluates two independent needs:

```
needGloss = translations[lang].transWord is empty
needDef   = word.definition is empty
hasDescription = (word.definition is non-empty) OR (translations[lang].transDfn is non-empty)

if needGloss AND NOT hasDescription:
    Prompt A   → gloss + transDfn + Korean definition   (one call; also satisfies needDef)
else:
    if needGloss:                 # hasDescription is true here
        Prompt B → gloss only (ground on Korean definition, else transDfn)
    if needDef:
        Prompt C → Korean definition only (ground on word + Hanja + existing gloss/description)
```

### Prompt A — case 1 (extended)

Same grounding as today (word, POS, Hanja characters + English meanings), but the
required JSON now also carries a Korean definition:

```
Translate a Korean dictionary word into {English|Russian}.
Provide (1) a concise gloss (dictionary-style, one word / short phrase),
(2) a translation of the meaning into {English|Russian}, and
(3) a short Korean-language definition (한국어 뜻풀이) of the word.
Use the Hanja origin to fix the precise sense.

Word: 혼혈
Part of speech: 명사
Hanja: 混血
  混 = mix, blend
  血 = blood

Return strict JSON only: {"definition":"...","transWord":"...","transDfn":"..."}
```

- `definition` (Korean) is written **only if** `word.definition` was empty — never
  overwrite a real KrDict Korean definition.
- `transWord` / `transDfn` fill the target-language translation (unchanged from
  today). Success requires a non-empty `transWord`.

### Prompt B — case 2 (new)

Grounded on the **description** (Korean definition preferred; fall back to the
target-language `transDfn`). Returns the gloss only:

```
Give a concise dictionary gloss for a Korean word in {English|Russian}.
Use the definition below to pick the exact sense. Output ONE word or a short
phrase — the gloss only, not a sentence.

Word: 유가
Part of speech: 명사
Hanja: 油價
Korean definition: 석유의 가격.

Return strict JSON only: {"transWord":"..."}
```

- Fills **only** `transWord`. The existing `definition` and `transDfn` are
  preserved untouched.
- Success requires a non-empty `transWord`.

### Prompt C — case 3 (new)

Grounded on the word, its Hanja, and whatever target-language meaning already
exists (gloss and/or `transDfn`). Returns a Korean-language definition only:

```
Write a short Korean-language definition (한국어 뜻풀이) for a Korean word.
One concise sentence, in Korean, dictionary-style.

Word: 황금
Part of speech: 명사
Hanja: 黃金
Meaning ({English|Russian}): золото

Return strict JSON only: {"definition":"..."}
```

- Fills **only** `definition`. The existing gloss and `transDfn` are untouched.
- Success requires a non-empty `definition`.

### Persistence (fill only the missing field)

- **Case 1:** patch `translations[lang] = { transWord, transDfn, source: "ai" }`
  (as today) **and** patch `words.definition`. Other language preserved via spread.
- **Case 2:** patch `translations[lang] = { transWord: <AI>, transDfn: <existing,
  preserved>, source: "ai" }`. Do **not** blank the KrDict `transDfn`; do **not**
  touch `words.definition`.
- **Case 3:** patch `words.definition` only, and only when it was empty (never
  overwrite a real KrDict Korean definition). Do **not** touch `translations`.

`source: "ai"` on the language object is what drives the AI footer. In case 2 the
gloss is AI even though the description is KrDict — marking the object `ai` is
honest (AI was involved) and keeps the footer correct.

### AI footer

No change to the footer logic — it already shows when `translations[lang].source
=== "ai"` (both cases set it) or when Hanja glosses are AI. The generated Korean
`definition` rides along with the case-1 `ai` translation, so it is attributed
correctly without a new marker.

### Failure handling

Unchanged: a failed/empty response leaves the message as-is, and the generic
`aiTranslateFailed` note is appended only when an attempt produced nothing new.

---

## Schema Change

**None.** The Korean definition reuses the existing `words.definition` field; the
gloss/description reuse the existing `translations[lang]` object whose `source`
marker already exists. No migration.

---

## Scope of Code Change

Touches (no new files required):

- `convex/wordPrompt.ts` — add the Prompt B builder; extend Prompt A to request a
  Korean `definition`; add/extend the parser(s) for the new JSON shapes
  (case-1 optional `definition`; case-2 `transWord`-only).
- `convex/translate.ts` — `translateWordToLang` branches on `hasDescription`,
  picks the prompt, parses the matching shape, and persists only missing fields.
  Pass the existing `transDfn` into the action so it can decide and preserve it.
- `convex/words.ts` — `saveAiWordTranslation` gains an optional `definition` arg
  (case 1) and a path that preserves an existing `transDfn` (case 2).
- `convex/wordPrompt.test.ts` — unit tests for the new builders/parsers.

`telegram.ts` and `hanjaFormat.ts` are unchanged (trigger condition and footer
already cover both cases).

---

## Code Style

Match `convex/translate.ts` / `wordPrompt.ts`: pure, network-free prompt helpers
in `wordPrompt.ts` (no Convex/OpenAI imports) so they stay unit-testable;
Convex `internalAction`/`internalMutation` with `v` validators; graceful
degradation (return `{ translated: false }`, never throw to the webhook).

---

## Testing Strategy

`bun test` (already set up). Add pure-helper unit tests:

- Prompt A includes the Korean-definition instruction and `definition` key; Hanja
  block still omitted for pure-Korean words.
- Prompt B includes the description and asks for `transWord` only.
- Case-1 parser: tolerates fences, fills `definition` only when present, requires
  non-empty `transWord`.
- Case-2 parser: requires non-empty `transWord`; ignores extra keys.

Manual e2e via the live bot + `bunx convex run` (see Success Criteria).

---

## Boundaries

- **Always:** fill only missing fields; preserve real KrDict `definition` /
  `transWord` / `transDfn`; mark AI-touched language objects `source: "ai"`; keep
  the synchronous webhook path fast (LLM work stays in the scheduled action).
- **Ask first:** changing the model or the case-selection heuristic; adding a
  `source` marker to `words.definition`; AI-translating EN Hanja char glosses.
- **Never:** overwrite a KrDict gloss/definition with AI output; blank an existing
  `transDfn` when filling only the gloss; commit secrets; issue a second
  concurrent `editMessageText` on the same message.

---

## Success Criteria

1. **Case 2 — `유가` (ru):** card upgrades to show `🇷🇺` gloss derived from the
   Korean definition; existing Korean definition and Russian description stay
   exactly as KrDict gave them; AI footer shows.
2. **Case 1 — `혼혈` (ru), fresh lookup:** card shows the `🇷🇺` gloss, a Russian
   description, AND a Korean definition line; AI footer shows.
3. **Only missing field filled:** in case 2 the KrDict `transDfn` is byte-for-byte
   unchanged; `words.definition` is untouched.
4. **No overwrite:** a word KrDict fully translated shows KrDict data, no AI call,
   no footer.
5. **Caching:** re-looking-up an AI-upgraded word is instant, still shows the
   footer and the generated Korean definition.
6. **Graceful failure:** LLM unreachable → card not left broken; no spurious gloss
   line; case-1 Korean definition simply absent.

---

## Open Questions / Known Limitations

1. **Gloss present but Korean definition missing (standalone):** not separately
   triggered — the upgrade fires on a missing *gloss*. Going forward, case-1 words
   get a Korean definition co-generated; pre-existing cached case-1 rows (e.g. the
   current `혼혈`) only gain it on re-translation. Acceptable, or do we want a
   one-off backfill? (Recommend: no backfill; let cache refresh naturally.)
2. **Korean definition has no `source` marker.** It inherits attribution from the
   case-1 `ai` translation object. If we ever generate a Korean definition without
   also generating an AI gloss, the footer would miss it — out of scope here.
3. **Case 2 with only `transDfn` (no Korean `definition`):** prompt B grounds on
   `transDfn`; the Korean definition stays absent (not generated in case 2).
