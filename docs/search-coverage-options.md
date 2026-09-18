# Search coverage: extra dictionaries vs grounded LLM

## Objective

Users often look up Korean words that **do exist** (in a real dictionary, or in everyday Korean) and the bot replies with no results. Today lookup has a single source: the KrDict Open API (`convex/krdict.ts`). This note compares additional **dictionary APIs** we can call alongside KrDict, and **LLM** approaches that stay correct (no invented Hanja / glosses).

No code changes in this pass — pick a fallback, then implement.

## Why lookups miss today

The live path is: cache → `searchWord` → keep only `r.word === query`.

```116:133:convex/krdict.ts
export async function searchWord(
	apiKey: string,
	query: string,
	lang: "en" | "ru" = "en",
): Promise<KrdictSearchResult[]> {
	const params = new URLSearchParams({
		key: apiKey,
		q: query,
		part: "word",
		sort: "dict",
		translated: "y",
		trans_lang: TRANS_LANG_CODE[lang],
		type2: "chinese",
	});
```

That is a **learner's dictionary**, not a comprehensive Korean dictionary:

| Dictionary | Approx. headwords | Role |
|---|---|---|
| 한국어기초사전 (KrDict) — what we use | **~53,700** | Learners; EN/RU glosses |
| 표준국어대사전 (STDICT) | **~423,000** | Official standard Korean |
| 우리말샘 (OpenDict) | **~1,160,000** | Standard + neologisms, dialect, technical |

So a word can be “real” on Naver / 표준국어대사전 and still be absent from KrDict. That is the largest miss class.

Other miss classes in *our* client, even when KrDict has the lemma:

1. **Sino-Korean filter.** `type2: "chinese"` restricts advanced search to 한자어. The API docs say this only applies with `advanced=y`, which word search does **not** set — so it may already be ignored. If it is applied, native Korean (`낯설다`) and mixed-origin words never match. Product already wants those words (AI word-translation spec covers 고유어). Hanja-example search should keep the chinese filter.
2. **Headword-only exact search.** Default KrDict `method` is exact match on the **표제어**. Inflected input (`했어요`, `먹는`, `학생들이`) misses the lemma (`하다`, `먹다`, `학생`). KrDict, STDICT, and OpenDict all support searching **활용** (conjugation): KrDict `advanced=y&target=6`, STDICT/OpenDict `advanced=y&target=5`.
3. **Client exact match.** `findExactMatches` drops anything where `word !== query`, then shows up to 5 suggestions. Close hits never become a result.
4. **Input routing.** Multi-character Hanja (`新聞`) is rejected; romanization is ignored. Out of scope here unless we later add Hanja→Hangul lookup via `origin`.

The existing OpenRouter path (`convex/translate.ts`) only **translates** an already-found entry. It never **finds** a missing word.

What a fallback must return to reuse the current card: Hangul `word`, Hanja `origin` (may be empty), `pos`, Korean `definition`. EN/RU can be filled by the current AI upgrade when the source has no `transWord`.

---

## Option A — Get more out of KrDict (no new key)

Keep KrDict as the first source (it is the only NIKL API with English and Russian).

| Change | Effect |
|---|---|
| Stop sending `type2: "chinese"` on **word** search | Native / hybrid / loanwords can match. Keep the filter on Hanja-example search. |
| On miss, retry `advanced=y`, `target=6` (활용), `method=exact` | Inflected verbs/adjectives resolve to the dictionary form. |
| Optionally retry `method=include` and keep today’s suggestion keyboard | Typos / extra particles still get “did you mean”. |

**Correctness:** still 100% KrDict. **Recall:** only inside the ~54k learner lexicon. **Cost / ops:** none.

Do this in every plan. It will not fix “word exists in 표준국어대사전 but not in 기초사전”.

---

## Option B — 표준국어대사전 (STDICT) as second source

- **API:** `https://stdict.korean.go.kr/api/search.do` (+ `/api/view.do` for full entry)
- **Auth:** separate key — [register](https://stdict.korean.go.kr/openapi/openApiRegister.do)
- **Format:** XML or JSON (`req_type=json`)
- **Fields we care about:** `word`, `pos`, `definition`, `origin` (한자 원어), `target_code`
- **Not included:** English / Russian — reuse `translateWordToLang`
- **Conjugation search:** `advanced=y&target=5`
- **Size:** ~8× KrDict, official standard language only (no slang dump)
- **Quality:** highest among Korean dictionaries; expert-edited

**Fit:** best “this is a real standard word” fallback. Sino-Korean compounds missing from KrDict will usually be here, with Hanja in `origin`.

**Cost:** free; need Convex env `STDICT_API_KEY`. Daily quota is provider-policy (not the same 50k KrDict cap).

---

## Option C — 우리말샘 (OpenDict) as second source

- **API:** `https://opendict.korean.go.kr/api/search` (+ `/api/view`)
- **Auth:** key from the dictionary site / [data.go.kr listing](https://www.data.go.kr/data/15019347/openapi.do)
- **Format:** XML or JSON, same family as KrDict/STDICT
- **Fields:** `word`, `pos`, `definition`, `origin`, `target_code`, plus `type` (일반어 / 방언 / 북한어 / 옛말)
- **Not included:** EN/RU — same AI fill-in
- **Conjugation search:** `advanced=y&target=5`
- **Size:** ~20× KrDict (~1.16M), including neologisms, dialect, North Korean, archaic
- **Quality:** public contributions, NIKL-reviewed. Broader and noisier than STDICT.

**Fit:** best raw recall (“the word exists somewhere official”). Filter `type3=general` (and skip dialect/NK/ancient) so the bot does not start teaching 제주 방언 unless we want that.

**Cost:** free; env `OPENDICT_API_KEY`.

---

## Option D — English Wiktionary (no key)

- **API:** `GET https://en.wiktionary.org/api/rest_v1/page/definition/{word}` (no auth)
- **Returns:** English gloss + POS + examples for a `ko` section when the page exists
- **Does not return:** structured Hanja `origin`. Etymology lives in wikitext (`ko-etym-*` / headword `hanja=`), so we would parse MediaWiki wikitext or skip breakdowns
- **Coverage:** much thinner than STDICT. Probe: `신문` works; `낯설다` is a 404 (no EN page)

**Fit:** zero-config English glosses for some common words, weak as a Hanja bot fallback. Use only if we refuse new NIKL keys.

---

## Option E — Naver / Daum (reject)

Unofficial scrapers exist. No public ToS-safe API, brittle HTML, ban risk. Skip.

---

## Option F — Ungrounded LLM as the dictionary (reject)

Ask Gemini for `{word, origin, pos, definition, transWord}` from parameters alone.

**Wrong for this bot.** Models invent plausible 漢字 for Sino-Korean words. A bad `origin` is worse than “not found”: the whole product is Hanja breakdowns. Already-locked rule for translations: never overwrite a real dictionary gloss with AI. Same rule must apply to **existence** of the entry.

---

## Option G — LLM as query rewriter only (safe)

On dictionary miss, one JSON call: “dictionary lemma + spelling variants for this Korean input”, then **re-run KrDict / STDICT / OpenDict**. Accept a result only if an API returns it.

Examples the model is good at and APIs are not: `햇어요` → `했어요` → `하다`; spacing (`고가도로` / `고가 도로`); 하다-adjectives.

**Correctness:** definitions and Hanja still come from NIKL. **Risk:** extra latency + OpenRouter cost on misses only. **Reuse:** same client as `convex/translate.ts`.

This is the only LLM role that is safe without citations.

---

## Option H — LLM + web search, official-dict domains only

OpenRouter `openrouter:web_search` with `allowed_domains` limited to e.g. `krdict.korean.go.kr`, `stdict.korean.go.kr`, `opendict.korean.go.kr`, `en.wiktionary.org`. Current default model (`google/gemini-3.1-flash-lite`) supports native search.

**Still not dictionary-grade.** Search snippets can be the wrong sense, a related compound, or a page the model misreads. We would have to **refuse** unless a citation URL + extracted lemma match the query (or the rewriter lemma). More moving parts than calling the same sites’ Open APIs.

Use only as a last resort after APIs, with a hard “no citation → no card” rule. Prefer G/B/C.

---

## Option I — LLM with dictionary tools (API function calling)

Same idea as G, but the model *calls* `searchKrdict` / `searchStdict` itself (several query variants in one turn). Correct iff we never display a tool-less model dump. Heavier than a fixed waterfall (KrDict → STDICT → optional lemma retry). Not needed for v1.

---

## Recommendation

**Waterfall, dictionary-first. LLM never authors an entry.**

```
cache
  → KrDict exact (no type2=chinese on word search)
  → KrDict 활용 (target=6) if no exact headword
  → OpenDict or STDICT exact   ← new source
  → same fallback, 활용 search
  → optional: LLM lemma rewrite, then retry the APIs once
  → still nothing: today's "no results"
```

Fallback hits have Korean `definition` + `origin`, empty `transWord`, `source: "stdict" | "opendict"`. The existing scheduled AI translation then fills EN/RU the same way it does for KrDict rows that lack a gloss.

### Which new API?

| Prefer | When |
|---|---|
| **OpenDict (우리말샘)** | Goal is “user typed a word that exists” — max recall. Filter to 일반어. |
| **STDICT (표준국어대사전)** | Goal is “only standard textbook Korean”, slightly cleaner Hanja-origin data. |
| **Both** | KrDict → STDICT → OpenDict. Best coverage, two new keys, more latency. |

**Pick OpenDict first** unless we want to stay strictly standard-language. KrDict stays primary because it is the only source with native EN/RU.

Wiktionary: skip while a NIKL fallback exists. Ungrounded LLM: never. Web-search LLM: not v1.

### Why not LLM-only after KrDict?

Hanja `origin` must be sourced. OpenDict/STDICT already expose it. AI is already paid for **translation**, which is the part dictionaries do not give us.

---

## Implementation notes (once a source is chosen)

1. **`targetCode` namespaces collide.** KrDict / STDICT / OpenDict all have integer ids that overlap. Add `source: "krdict" | "stdict" | "opendict"` on `words` and key uniqueness by `(source, targetCode)`, or namespace ids. Do not `saveMany` a STDICT row on top of a KrDict row with the same number.
2. **`translations[lang].source`** already distinguishes `krdict` vs `ai`. Fallback rows start with no gloss → current `computeTranslationNeeds` will schedule AI. Stamp the card so users can tell NIKL vs AI (footer already exists for AI).
3. **Lemma from 활용 search.** If the user typed `했어요` and we matched `하다`, show the **lemma** card and a one-line “dictionary form of {query}” so it does not look like a wrong hit.
4. **Latency.** Webhook stays sync. Run KrDict first (today’s happy path). Only call the second API on miss. Optional LLM rewrite is last, same as today’s background upgrade, or a second spinner edit.
5. **Keys.** `KRDICT_API_KEY` stays required. New `OPENDICT_API_KEY` and/or `STDICT_API_KEY` optional: if unset, skip that step.
6. **Hanja examples** (`searchHanjaExamples`) stay KrDict + `type2: chinese`. Different problem.

### Files that would change later

- `convex/krdict.ts` — drop word-search `type2`; add 활용 retry
- new `convex/opendict.ts` or `convex/stdict.ts` — same XML/JSON shape as KrDict
- `convex/lookup.ts` — waterfall in `searchFromApi` / `resolveWord`
- `convex/schema.ts` + `convex/words.ts` — `source` on word rows
- `convex/telegram.ts` — inject the extra client; keys from env
- `convex/i18n.ts` — “showing dictionary form …” copy
- tests next to the new client + `findExactMatches` / lemma mapping

---

## Decisions needed before coding

| # | Question | Suggested default |
|---|---|---|
| 1 | Second dictionary: OpenDict, STDICT, or both? | **OpenDict** (recall), `type3=general` |
| 2 | Drop `type2: chinese` on word search? | **Yes** (keep it on Hanja examples) |
| 3 | On miss, KrDict 활용 search before the second API? | **Yes** |
| 4 | LLM lemma rewrite after both APIs miss? | **Yes, v2** — APIs first |
| 5 | Ungrounded or web-search LLM as a dictionary | **No** |

Once 1–3 are confirmed, next step is a small implementation spec (schema + waterfall + tests), then the client.
