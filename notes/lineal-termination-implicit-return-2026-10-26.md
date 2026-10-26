# Lineal function termination & implicit tail return (2026-10-26)

Design discussion + implementation scoping. No implementation. Follows directly
from `return-keyword-and-arrow-2026-10-26.md` and **qualifies its "retire `->`"
framing** (see Relationship below). All line anchors are `src/parser.js` /
`src/lexer.js` as of this date.

## The decisive current-behavior fact

Lineal (non-braced) function bodies **do not do implicit tail return today.** A
braced body does — the `stopToken` branch turns any trailing expression into an
`implicitReturn` (`parser.js:3386–3406`), and a post-loop pass normalizes a
trailing `Assign`/`Reply` the same way (`:3439–3461`). The lineal branch
(`:3407–3423`) accepts only sigil / paren / `ident,comma` reply-shapes and
otherwise **throws `Unexpected token in function body`**. So a lineal function
ending in a bare `x * 2` or a bare identifier is a parse error now; the
lineal_form tests carry `-> result: …` / `-> :x` everywhere precisely because
the bare tail isn't legal.

## Reframe: `->` is the lineal body's closer, not a "return glyph"

A braced body can do implicit return because `}` marks where it ends — "the last
expression is the value" is unambiguous and internal blank lines are free. A
lineal body has **no closing token**. A blank line can end the unit, but it
cannot say *which* preceding expression was the yielded tail vs. a discarded
side-effect, and it cannot let two definitions abut. `->` supplies exactly that:
"the body's value is this, and the body is now complete," in one glyph.

So `->` has one coherent job — "here is the yielded body/tail" — showing up as
the whole body in a one-liner (`x -> x*2`) and as the closing tail in a lineal
sequence. Braces are the alternative closer; where you have braces you don't
need `->`, where you don't you do. This dissolves the "return/lambda overload":
in lineal form `->` is structure (the brace you don't have), not decoration.

## Current termination (code, not notes)

Lexer (`lexer.js:198–219`): single `\n` → `NEWLINE`; `;` → `NEWLINE` (`:540`);
a blank/whitespace-only line → `BLOCK_SEP`, and **any run of blank lines
collapses to one `BLOCK_SEP`** (`:206–212`); `--` alone → `DIVIDER`.

Two skip helpers are the whole mechanism (`:155–156`): `skipNewlines()` eats
`NEWLINE` only; `skipBlanks()` eats `NEWLINE` + `BLOCK_SEP`.

| unit | terminated by | blank line inside? |
|---|---|---|
| lineal **function** (`parseBody`, `:3122`) | `BLOCK_SEP`, `->` (breaks, `:3134`), `.` (`:3128`) | no — first blank ends it |
| lineal **class** (`parseActorBody` `:4039`, `parseConstructorBody` `:3976–3988`) | `.`, `end` / `end#label`, EOF / `}` | yes — `skipBlanks` swallows them |

The function/class asymmetry already exists; it's keyed on token *type*, not on
blank-line *count*. (Triple-LF for classes would need the lexer to stop
collapsing and grade whitespace by magnitude — rejected: invisible, fragile,
non-nesting, and re-creates a magnitude-overload. Keep the visible `.`/`end`.)

## Goal: double-LF termination + implicit tail return, `->` not load-bearing

What it takes (the terminator half is already built — `BLOCK_SEP` already means
"≥1 blank," `parseBody` already stops on it; double-LF needs only 0-vs-1, so **no
lexer change**, unlike triple-LF). The work is in `parseBody` tail handling plus
two grammar tightenings:

1. **Turn the `:3423` throw into a tail return.** Let the loop collect bare
   expressions as expr-statements, then a **post-loop normalizer** (mirror the
   braced arm `:3439–3461`) converts the last node to `implicitReturn` unless
   silent. Reuses the existing `implicitReturn` AST node → JS/Rust/Erlang codegen
   already emits it, so the change is parser-local and low per-target risk.
2. **Legislate statement-vs-tail.** Last expression returns; earlier bare calls
   stay side-effects; `.` / `()` opt out to silent/void. Already the braced
   convention. Behavior change to accept: a lineal function ending in a
   side-effecting call now returns that call's value unless ended with `.`.
3. **Make the blank line a REQUIRED member separator — the actual load-bearing
   cost.** A bare-tail body has no closer, so two lineal members can't abut
   (today `->` is what lets them). `parseActorBody`/top-level must require
   `BLOCK_SEP` (or `end`/`}`/EOF) between lineal members and reject a bare
   `NEWLINE` boundary, or a body greedily eats the next member's lines. Also
   permanently bans internal blank lines in lineal functions (use `{ }` to
   breathe).
4. **Commit to "one expression per line"** — no expression continuation across
   bare newlines. This is what keeps tail-detection tractable. Already ~true;
   lock it in.
5. **Budget diagnostics.** The glyph was the parser's anchor; without it a stray
   internal blank silently splits a function and a missing separator silently
   merges two. Add targeted errors or the spacious form gets sharp edges.
6. **Tests.** `__tests__/functions/lineal_form.test.js` and
   `classes/lineal_form.test.js` encode `-> result:` everywhere; add bare-tail
   companions. Churn is parse-tree assertions, not backend.

## The named-return "boundary" dissolves — and parens aren't even needed inline

Earlier drafts of this note called named / multi-field returns a hard boundary
because bare `result: 42` seemed to collide with `name: Type` binding. **There is
no collision in kind.** A `key: value` tail matches neither binding predicate:
`isTypedAssignStart` (`:2841`) requires a type then `=`; `isBareTypeDeclStart`
(`:2879`) requires `IDENT IDENT` (name then type-name) with no `=`/`,` after.
Both put a *type* after the name. `x: 123` puts a *value* after a colon — that is
categorically a reply field, not a binding. So the bare same-line forms are
unambiguous and need no parens:

- `123` — single positional
- `x: 123, y: 456` — named multi-field (comma-separated, same line)
- `:x, :y` — sigil structuring

(Still new work: the lineal branch currently *throws* on a bare `IDENT COLON`
tail at `:3423` — it routes only sigil / paren / `ident,comma` today. You're
extending it, but there's no ambiguity to resolve.)

## Where it actually gets hairy: the multiline reply — and the opener already exists

A **multiline** tail with each field on its own line and no delimiter —

```
x: 123
y: 456
```

— is the genuinely dicey case. Bare "accretion" (merge the trailing run of
`key: value`/sigil lines into one reply, stop at the blank) is implementable but
fragile: a `key: value` line has no meaning other than "tail field," so it's a
tail-only special rule the parser must reject mid-body; there is no start or end
marker, so the object is defined purely by "run of field-lines ending at a
blank," which silently splits under editing and gives poor errors. Not
impossible — just not worth it.

The reframe: **the multiline opener already exists.** The `-> \n fields` *open
form* (`parseBody:3141`) reads newline-separated fields via `parseReplyFields`
in multi-line mode (`:2241` skips newlines between fields) until the blank line.
So the question is not "invent an opener" but "what to spell the existing one,"
given `->` is leaving returns. That choice maps onto the **dense/spacious
duality**:

- **dense** → `( x: 123 \n y: 456 )` — parens as the object literal,
  self-delimiting at both ends; already parses (`:3410` → `parseReplyFields`
  hasParen path).
- **spacious** → a word-opener block (what `-> \n` does today), respelled
  `return`:
  ```
  return
    x: 123
    y: 456
  ```

This is the one slot `return` earns — as a **block opener for a multiline
structured reply** (delimiting, not value-marking), replacing the `-> \n fields`
open form. It does *not* reverse "`return x` inline earns nothing": bare `x`
still beats `return x` for inline single values. `return` is only ever the
spacious multiline-reply opener.

Caveat: `return \n fields` (like `-> \n` today) only *half*-delimits — explicit
start, but the **blank line closes it**. Parens close both ends. So the spacious
form is not an escape from blank-line dependence; it leans on the same
blank-as-terminator that is load-bearing throughout this design. Consistent, but
worth seeing clearly.

## Total return surface (glyph-free)

- bare single positional → `123`
- bare same-line multi/named → `x: 123, y: 456`
- bare sigil structuring → `:x, :y`
- dense multiline reply → `( x: 123 \n y: 456 )`
- spacious multiline reply → `return \n  x: 123 \n  y: 456`
- silent / void → `.` / `()`

Consequence: **`->` leaves the return role entirely** — inline *and* the
`-> \n` open form. It survives only as the lambda one-liner arrow (`x -> x*2`)
and the constructor-tail becomes (`-> self` / `-> expr`).

## Scope verdict

Contained, parser-concentrated change — no lexer work, no codegen rework:

- post-loop normalizer at `:3423` (bare tail → `implicitReturn`);
- extend the lineal branch (`:3409–3423`) to accept a bare `IDENT COLON …` /
  same-line comma list as a reply (route to `parseReplyFields`), not just
  sigil/paren/`ident,comma` — the same-line named forms;
- respell the `-> \n fields` open form (`:3141`) as the `return` block opener for
  spacious multiline replies; keep `( … )` as the dense multiline form (already
  parses);
- require `BLOCK_SEP` / `end` as the member separator (bans abutting + internal
  blanks) — item 3;
- carry `.` / `()` as the silent/void opt-out;
- diagnostics + bare-tail / multiline-reply test companions.

Named returns were never the blocker. **The whole price is the blank line
becoming the mandatory, load-bearing member boundary** (item 3) — which is
exactly the "termination depends on double LF" goal.

## Relationship to `return-keyword-and-arrow-2026-10-26.md`

That note proposed retiring `->` as a return glyph in favor of `return` +
implicit tail return. Reconciled position after the parens finding above:

- In *braced* form implicit return already works, no marker needed.
- In *lineal* form `->` can also leave the return role, **provided** you accept
  the blank line as a mandatory member separator (item 3) and spell named/multi
  returns as paren objects `(…)`. It is the *blank-as-separator* that becomes
  load-bearing, not `->` — my earlier "`->` is the irreplaceable closer" claim
  was too strong; the closer job can move onto `BLOCK_SEP`/`end`.
- `return` as an *inline* value marker still earns no place: a bare tail needs no
  word, and `return x` is a heavier, worse-reading spelling. It earns exactly one
  slot — the **spacious multiline-reply block opener** (delimiting, not
  value-marking), replacing the `-> \n fields` open form.

So retire the *framing* ("`->` is return") **and** the glyph's return role; `->`
persists only as the lambda one-liner arrow and the constructor-tail becomes.
The gradient:

- braced `{ … }` → implicit tail return, internal blanks allowed;
- lineal → bare tail (single / same-line named / sigil) / `( … )` (dense
  multiline reply) / `return` block (spacious multiline reply) / `.` (silent);
  members separated by blank line or `end`; no abutting, no internal blanks.
