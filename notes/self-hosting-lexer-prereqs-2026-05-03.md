# Self-hosting brevity: lexer-port prerequisites

Date: 2026-05-03

## Framing

WASM-as-a-browser-target and WASM-as-the-compiler are both reasonable
ideas, but the cheap way to get there is **self-hosting** the brevity
compiler in brevity, then leaning on the existing multi-target backend
(JS / Rust / Erlang) to produce all output forms — including
`compiler.bv → rust → wasm32` — for free.

Self-hosting payoff:

- One implementation; every backend benefits from compiler-side fixes.
- WASM compiler "falls out" of the Rust pipeline that already exists.
- Forcing function: language has to be complete enough to express its
  own compiler. Largest dogfood program possible.
- Bootstrap is mechanical: Stage 0 (today's JS compiler) compiles
  `compiler.bv` → Stage 1; Stage 1 recompiles itself → Stage 2;
  fixed-point byte-equality check retires the JS compiler.

Costs:

- Porting effort comparable to a Rust rewrite — but the artifact is
  more useful.
- Feature ordering tax: a feature can only be *used* in `compiler.bv`
  one stage after it ships.
- Codegen bugs can self-mask ("trusting trust" lite). Mitigation: keep
  the JS compiler as a cross-check oracle for a long time.

Pragmatic path: port piece by piece (lexer → parser → validate →
inference → codegen), diffing each stage's output against the JS
reference on a corpus.

## Why the lexer first

`src/lexer.js` is 580 lines, the smallest stage, and has the cleanest
input/output contract (Text → list of tokens). If brevity can express
the lexer pleasantly, every later stage will be easier; if it can't,
the awkwardness will compound 10× by the parser. The lexer is the
language's self-hosting smoke test.

## Design questions to settle BEFORE the lexer port

These are language-level decisions, not lexer mechanics. Each one
affects the whole self-hosting roadmap.

### 1. Code-point vs grapheme: is there a `CodePoint` (or `Char`) type distinct from `Text`?

A lexer fundamentally operates at code-point granularity.

- `Text.at(source, i)` today returns a 1-grapheme `Text`. Fine
  semantically, but:
  - You can't do `ch >= '0' and ch <= '9'`; every classification
    becomes a `.contains(/[0-9]/)` regex call per character.
  - Graphemes ≠ code points. Source-code lexing wants code points;
    grapheme-only is technically incorrect (ZWJ sequences,
    combining marks).
- Decide: introduce `CodePoint` (or `Byte`), **or** commit to
  "everything is `Text`" and add a fast
  `Text.code_point_at(i) → Integer` so classification can be
  integer-comparison cheap.

### 2. Are mutable cells (`Type!`) appropriate for local loop state, or are they actor-only?

A lexer wants `i Integer!` and `tokens List of Token!` as plain locals
inside a proc.

- `LANGUAGE_OVERVIEW.md` examples show cells in actor-state context.
- If cells in lambdas/procs work today: confirm and document.
- If not, options:
  - (a) make cells ergonomic in any scope
  - (b) add a separate `mut` local
  - (c) commit to functional-style with explicit
    `(i, tokens) <- step(...)` rebinding — the lexer becomes a
    tail-recursion exercise. Doable but invasive.

### 3. Cheap iteration over `Text` with index?

Equivalent of `for (i, ch) in source.code_points()`.

Without it, every position-aware scan becomes:

    repeat while i < size
      ch = Text.at(source, i)
      ...
      i <- i + 1

…which works, but the lexer writes that loop ~100 times. A native
indexed iterator over code points (or whatever decision (1) settles
on) is the difference between "tolerable port" and "pleasant port."

## Stdlib gaps (no design call, just additions)

- `is_digit / is_alpha / is_alnum / is_hex_digit / is_whitespace`
- `is_identifier_start / is_identifier_continue`
- `Text.code_point_at(i) → Integer` (if (1) goes the all-Text route)
- `Integer.to_text` (probably already present — verify)
- `Text.from_code_point(n)` for escape-sequence reconstruction

Without these, every classification is a regex call per character.
Functionally correct, performance/readability terrible.

## Non-issues (audit flagged, but actually fine)

- **No `i++`** — `i <- i + 1` is cosmetic only.
- **No `+=` for strings** — `buf <- buf.append(ch)` is fine.
- **No dynamic regex from string** — the lexer doesn't construct
  regexes; it emits a `REGEX` token whose value is the pattern *text*.
  Downstream stages decide what to do with it.
- **List accumulation cost** — only matters if `List.append` copies.
  If the impl is structurally shared (cons/Vec-style), it's fine. If
  not, a port will be slow but correct; performance is a follow-up,
  not a blocker.

## Recommended next step

Before touching the lexer, write a **smoke-test proc** in brevity:

> Take a `Text`. Walk it code-point by code-point. Classify digits.
> Return a list of `(start, end, kind)` triples.

If that program is *pleasant* to write and read, the lexer port will
be too. If it's awkward, fix the language first — the awkwardness
will scale 100× by the parser.

## Open questions / things to verify when revisiting

- Confirm whether `Type!` cells work as locals inside a proc/lambda
  today. (Examples in `LANGUAGE_OVERVIEW.md:143` are actor-state-shaped;
  intent in non-actor scope is unclear from docs.)
- Confirm `List.append` cost characteristics — structurally shared or
  copying?
- Confirm whether `Text.at` returns a grapheme or a code-point today
  (the audit assumed grapheme; verify against
  `src/text_methods.js`).
- Audit `__tests__/` for any existing brevity program that does
  character-by-character scanning — that's the closest existing
  evidence of how painful (or not) the lexer port will feel.
