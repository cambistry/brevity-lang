# `return` replaces `->` as the value-return (clean break) — 2026-10-28

IMPLEMENTED (js green: 144 suites / 2707 passed; rust/erlang/browser not run — see
below). Realizes the direction in `return-keyword-and-arrow-2026-10-26.md` /
`lineal-termination-implicit-return-2026-10-26.md`, but as the *narrow* swap the
conversation asked for, not the full lineal-termination rework.

## Decision (from the conversation)

- `return` is the explicit value-return keyword. It replaces `->` in return
  position.
- `->` survives ONLY as the lambda / body-opener arrow and in function-type
  signatures. It is **no longer** a return statement — **no backward compat**
  (there is no userbase). A `->` return inside a braced body, or after another
  statement in a lineal body, is a **parse error**.
- Implicit tail return (braced bodies) is unchanged.
- Ambiguity rule: where a `->` could be read as *either* a lambda/body-opener
  *or* a return (the sole-tail one-liner `@get = -> x`, i.e. `->` is the first
  and only thing in a lineal body), it stays `->` and the tail is the implicit
  return. Only an *unambiguous* return (`->` after a statement, or anywhere in a
  braced body) becomes `return`.

## Parser/lexer (`src/`)

- `lexer.js`: added `return` to `KEYWORDS` (distinct from the existing `returns`
  type keyword).
- `parser.js`:
  - New helpers `isReturnKw()` and `MISPLACED_ARROW_MSG` (`'->' is the lambda
    arrow and can't start a statement here` — a plain misplaced-arrow syntax
    error, NOT a "deprecated feature" message; `->`-as-return was never a
    shipped feature to anyone).
  - Three body loops — `parseBody`, `parseFunctionBody`, `parseWhileBody` — now
    accept `return <reply>` (`.` silent, `()` void, `\n`-open multiline, inline
    reply fields). A bare `->` in those loops throws `MISPLACED_ARROW_MSG`,
    **except** in `parseBody` when `!stopToken && body.length === 0` (the lineal
    sole-tail one-liner), which is kept.
  - Constructor-block tail (`parseActorBody`) and the two file-class tail paths
    (`parseConstructorBody`, the `*( … )` paren branch in `parse`) accept
    `return` alongside `->`. `-> self` / `return self` becomes still works; `->`
    persists here as the becomes arrow.

Kept as `->` (unchanged): lambda values (`x -> e`, `(p) -> {…}`), one-liner
handlers/getters (`@get = -> x`), inline branch bodies (`if c -> v`,
`while/over/repeat` headers), `self as X = -> e`, function-type signatures
(`get: (u) -> (r)`, `… -> .`).

## Migration (tests + docs)

Scripted sweep (see scratchpad `migrate.mjs`/`migrate2.mjs` logic; not committed):
converted `->` → `return` for (a) line-initial returns except those whose prev
non-blank line ends in `=` (lineal sole-tail → kept), (b) `{ ->` braced
one-liners, (c) `; ->`, (d) embedded `\n ->` in single-line strings except
`=\n ->`. Same-line `<stmt> -> result:` cases (destructure handlers in
`core_types/structure.test.js`, one in `arrow_block_lambda.test.js`) hand-fixed.
~1480 conversions across ~140 test files + docs.

- `docs/self-sends-implementation.md` EXCLUDED from the sweep (it is Erlang/Rust
  implementation code, whose `->` are target-language, not Brevity). Its prose
  `-> :x` reply mention (~line 236) was left as-is; update if desired.
- Doc prose: `LANGUAGE_OVERVIEW.md` ("Replying functions use `->`" → now names
  `return` + the one-liner `->`; the spacious lineal example now uses `return`).
  `SYNTAX_CRIB.md` / `LLM_WRITING_BREVITY.md` examples migrated; interface
  signatures correctly keep `->`.
- New tests: `__tests__/functions/return.test.js` → `describe('`->` no longer
  introduces a return')` asserts `fn = () { -> val }` and friends throw, that
  `return` works, and that the lambda/one-liner `->` forms still parse.

## `return` is not assignable (not an expression)

`@get = return x` must be a parse error: no function body is opened there and
`return` is not a value, so it can't be the RHS of `=`. It already errored (the
`@op` public-handler guard), now with a `return`-specific message
(`'return' cannot be the right-hand side of '='…`, parser.js ~3608, keyed on
`isReturnKw()` before the generic guard). Non-`@` / local RHS (`x = return 5`,
`f = return x`) already error at `parseExpr` ("Unexpected token in expression:
KEYWORD 'return'") — no code change, test only. Covered by
`describe('`return` cannot be a right-hand side')` in return.test.js. Contrast
kept-valid: `@get = -> x` (arrow one-liner) and `@get = { return x }` (braced).

## Follow-ups / not done

- rust / erlang / browser projects NOT run here. Parser is shared and the AST
  (reply / returnNode / implicitReturn) is unchanged, so codegen is unaffected
  and they should be green — but run them. **Clear `rust/cache/` first** (test
  sources changed — stale-binary gotcha).
- Whether to also retire the kept sole-tail `->` one-liner in favour of `return`
  / bare implicit tail (the bigger lineal-termination rework) is still open.
