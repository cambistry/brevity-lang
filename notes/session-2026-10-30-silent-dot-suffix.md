# Session 2026-10-30 — silent functions: glued `.` on the name

Implements the silent-function part of `silent-dot-suffix-2026-10-30.md`.
Bang functions unchanged. `spawn` left in place (to be reviewed next).

## Language

- **Definition.** A silent function is named with a glued `.`: `fire. = { … }`,
  `@go. = (n Integer) { … }`, `#log. = …`, lineal `fire.` header. The parser
  appends the silent terminator; the tail value is discarded. An empty silent
  body is `fire. = {}`, or a lineal header whose `=` is followed by a blank line.
- **No terminating `.`** in a named declaration's body: `{ x . }`, `return .`,
  `-> .` and the bare-param `x -> expr .` are errors naming the fix. Lambdas
  (and subscription bodies) keep their trailing `.` — follow-up ticket. A lone
  `.` closing a lineal class is unchanged.
- **Early exit.** A bare `return` in a silent function; `return value` is an
  error. Inside a branch it becomes an empty `Return` (a guard on every
  backend); the function's trailing terminator keeps it reply-less.
- **`set` / `update`** (implicit bang) drop their trailing `.`; internally they
  keep the reply-less shape. `set = (params) -> stmt` ends at its line.
- **Calls.** `call...` is fire-and-forget. Right after a name the ellipsis
  absorbs the dot (`fire...`, `x.ping...`); elsewhere it's written
  (`bump.(7)...`, `Log.write.(:m)...`). A local call becomes a `SpawnStatement`
  (validator, once the actor's functions are known); a member call keeps its
  statement, marked `ellipsis`. A dotted call without `...`/`spawn`, and `...`
  on a non-dotted, non-bang name, are errors. `fire()` where only `fire.`
  exists names the silent call. `fn` and `fn.` may coexist.
- **Overloads** split by name: `@x.` and `@x` are separate ops.
- **Interfaces / service docs.** `ping. () -> .`; `-> .` requires the dot and the
  dot requires `-> .` (bang entries like `poke! () -> .` exempt). Rendered docs
  show the dot. Wire ops carry it: `@ping.`.
- **Silent reference fields.** `press.: () -> .` in a type; `c.press...` /
  `c.onpress.(sig)...` to launch, `c.press.` to read; `Panel(onpress.: …)` to
  construct. Stored and sent on the wire without the dot (a type can't hold both
  `x` and `x.`); rendered with it. The browser `::Event` manifest now declares
  `prevent.:`, `stop.:`, `stop_immediate.:`.

## Lexer

A run of dots right after a name: one dot not starting a member name is part of
the name (`fire.`, also after `:`, `&`, and keywords); three is an ellipsis;
two or four-plus are errors (`fire....` → "write `fire...`").

## Backends

- JS: `.` in a method name → `$` (`#op_go$Fn`). Early exit in an `if` branch
  emits (previously dropped); a silent delegate never assigns `re`.
- Rust: `rustIdent` maps `fire.` → `fire__s`; private functions run a leading
  guard before their statements (as public handlers already did); a silent
  handler's guard returns no reply.
- Erlang: `fire.` → `fire__s` in function atoms; a silent body's early-exit
  `if` is a guard, never the tail value.
- Silence detection everywhere also accepts a dotted name.

## Pre-existing bugs fixed on the way

Early `return .` inside an `if` in a silent function was broken on all three
targets (JS dropped the exit and replied; Rust/Erlang failed to compile).

## Tests

New `__tests__/functions/silent_dot.test.js` (16). Migrated ~460 terminator
sites across the test corpus, plus docs (`LANGUAGE_OVERVIEW.md`, `USAGE.md`,
`docs/`, `agent-resources/`, test-dir `.md`). JS green on every directory;
browser green on the touched browser files; rust + erlang green on
silent_dot and 13 of the most-changed suites (131 tests). Full suites not run.

## Open

- Lambdas filling silent slots — follow-up ticket.
- `spawn` vs `...` review.
- Params/locals holding silent refs aren't dotted yet (`cb: () -> .`).
- Dead `v.endpoint!` branches in rust/erlang/js expression codegen.
