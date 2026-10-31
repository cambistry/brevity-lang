# Silent functions: glued `.` name suffix (DESIGN, 2026-10-30)

Status: silent-function part IMPLEMENTED 2026-10-30 (`session-2026-10-30-silent-dot-suffix.md`); bang parts not. Companion to
`bang-returns-self-2026-10-27.md` and `bang-name-suffix-enforcement-2026-10-27.md`.

## Motivation

A silent function was marked only by a trailing `.` at the end of its body
(`sfn = (arg) { do_something . }`) — too quiet. The mark moves to the name,
mirroring `!` for mutate-and-return-self.

## Result slot and name suffix

The slot after `->` states the result kind; the name suffix repeats it where
the reader looks first.

| Kind            | Type             | Name    |
|-----------------|------------------|---------|
| replies a value | `(args) -> (T)`  | `fn`    |
| replies self    | `(args) -> !`    | `fn!`   |
| replies nothing | `(args) -> .`    | `fn.`   |

Declarations: `sfn. = (args) -> body`, `@sfn. = { … }`, lineal `sfn.` header.
Service doc: `sfn. (arg) -> .` (redundant, accepted).

## Rules

- **Glued.** Both sigils attach to the name with no space (lexer absorbs them
  into the IDENT, as it already does for `?`). `x .` (spaced) stays the
  terminator; `x.` after a name is the suffix.
- **Body.** A `.`-named body is silent by its name: no tail `.` and no
  `return value` (as a bang body allows no `return`). Enforced both ways, like
  the `!` suffix rule: `fn.` requires a silent body; a silent body requires `fn.`.
- **Call site: trailing `...` (fire-and-forget) is required on silent calls**
  and allowed on bang calls; illegal on value-returning calls (there is no
  reply to forgo — call and discard instead).
  - `sfn.(args)...`, `sfn. a ...` (no-paren args, if ever allowed)
  - `bfn!(args)...`, `bfn!...`, `bfn!(args).method` (self reply is a ref)
- **Three-dot elision.** When the ellipsis touches the name it absorbs the
  dot: `sfn...`, never `sfn....` (rejected: "write `sfn...`"). Elsewhere the dot
  is written.
- **`fn` and `fn.` may coexist.** `...` is illegal on a value-returning call
  and a bang call keeps its `!`, so `fn...` can only mean `fn.`. The suffix is
  part of the name everywhere — references, wire op names (`@fn` ≠ `@fn.`),
  service docs, imports.
- **Silent reference fields** (`dismiss: () -> .`) are silent functions.
  Proposed: suffix on the field name (`dismiss.: () -> .`) and `...` at the
  call (`s.dismiss...`). Open: suffix on the name vs. type alone. (The older
  `v.ref!` call form no longer exists — bang-name enforcement 2026-10-27 made
  `!` part of the name; silent fields are called `s.dismiss()` today.)

## Lexing

Count the dot run directly after an identifier:

| Run          | Tokens                         |
|--------------|--------------------------------|
| `sfn.method` | member access (dot + name char) |
| `sfn.` + other | IDENT `sfn.`                 |
| `sfn...`     | IDENT `sfn`, ELLIPSIS (resolves to `sfn.`) |
| `sfn....`    | error — write `sfn...`         |
| `sfn..`      | error                          |

The current lexer takes `...` greedily before `.`; the run count replaces that
after an identifier.

- `!=` keeps priority: `bfn!=x` is not-equal, so a bang declaration is spaced:
  `bfn! = …`.
- Breaking: a glued terminator after a name (`x.` ending a statement) is legal
  today and becomes the suffix. Corpus check (2026-10-30): 254 spaced `x .`,
  zero glued; zero unspaced `a!=b`; zero `name...`. Error for the glued form:
  "`x.` names a silent function; a terminator needs a space: `x .`".
  `f().` (after `)`) is unaffected.

## Errors to name the fix

- `fn...` with only a value-returning `fn`: "returns a value; `...` needs a
  silent `fn.` or a bang function".
- `sfn.(args)` without `...`: "silent call — add `...`".
