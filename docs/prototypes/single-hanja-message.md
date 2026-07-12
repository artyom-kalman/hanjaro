# Prototype — single-Hanja message layouts

> Question: How can a single-Hanja lookup be easier to scan in a Telegram
> bubble without losing the character's reading, meanings, and practical word
> examples? This is a decision artifact, not a production spec.

## Current layout

The current reply is structurally a character breakdown followed by up to five
examples. Every meaning and every reading receives its own line.

```text
學
 · study
 · learning
 · school
🇰🇷 학  🇨🇳 xué

Examples in Korean words
 · 학생 學生 — student
 · 학교 學校 — school
 · 학문 學問 — learning
 · 대학 大學 — university
 · 학원 學院 — academy
```

Its problem is not the amount of information, but that all of it has equal
visual weight. The character, its core idea, and five optional examples ask for
attention at once.

## Direction A — compact reference card

Keep the whole answer in one message, but make the character and its core idea
one compact block. Show only three examples by default.

```text
學  ·  학  ·  xué
<i>study · learning · school</i>

<b>Common words</b>
학생  學生 — student
학교  學校 — school
학문  學問 — learning
```

**Best for:** quick reference and the lowest-risk revision.

**What changes:** format meanings inline; combine the readings; reduce the
single-character example limit from 5 to 3. No new interactions or callbacks.

**Trade-off:** examples are still part of the initial bubble, so entries with
long translations can still feel dense.

## Direction B — character first, examples as actions

Make the reply a small character card. Move examples out of the text and turn
them into buttons that open the existing word lookup flow.

```text
<b>學</b>
학  ·  xué
<i>study · learning · school</i>

[ 학생 · student ]
[ 학교 · school ]
[ 학문 · learning ]
```

**Best for:** learning by association. The character is unmistakably the hero;
examples become invitations to explore rather than competing text.

**What changes:** `handleSingleHanja` builds an inline keyboard from the fetched
examples. It can reuse the existing `wq:<word>` callback, which already runs a
word lookup. The textual examples section goes away.

**Trade-off:** the Chinese origin (e.g. `學生`) is hidden until the user opens
the word, and an inline keyboard can become tall in a narrow Telegram client.
Limit to three one-button rows.

## Direction C — progressive disclosure

Send only the essential character reference initially, with one explicit
`Examples (5)` button. Tapping it edits the same bot message to an examples
view with a Back button.

```text
<b>學</b>  ·  학  ·  xué
<i>study · learning · school</i>

[ Examples (5) ]
```

Expanded view:

```text
<b>學</b> in Korean words

학생  學生 — student
학교  學校 — school
학문  學問 — learning
대학  大學 — university
학원  學院 — academy

[ ‹ Character ]
```

**Best for:** the cleanest default and users who usually want a fast answer,
but sometimes want depth.

**What changes:** add callbacks for the compact and expanded states and render
both views. The examples request can happen only after the button is tapped,
which also removes the current up-to-five-second wait from the default lookup.

**Trade-off:** it adds a small two-state interaction and one extra tap before
examples. It is the most deliberate learning experience, but it is more work
than the other two directions.

## Recommendation

Start with **Direction C** if “too crowded” describes the first impression:
the default message becomes a three-line answer, and the existing examples
feature remains available on demand. Its character-first hierarchy fits a
Hanja-learning bot particularly well.

Choose **Direction B** instead if examples are the primary learning mechanic:
it keeps them immediately visible as choices, without turning the message into
a list.

Choose **Direction A** if preserving the current one-message, no-tap flow
matters more than a major hierarchy change.
