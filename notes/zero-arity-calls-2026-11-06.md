# Optional parens on zero-arity calls (DESIGN, 2026-11-06)

Status: settled and IMPLEMENTED 2026-11-06 (uncommitted), every target; see
"Implementation" at the end. `&svc.foo` is a follow-up. Builds on
[silent-dot-suffix](silent-dot-suffix-2026-10-30.md),
[mutation-suffix](mutation-suffix-2026-10-31.md) and
[published-params](published-params-2026-10-29.md) decision 2 ("bare reads are a
general zero-arity principle").

## Rule

A call with no arguments may drop its parens, wherever a call can appear: local,
own public, member, and in a chain.

| Form | Meaning |
|---|---|
| `actor.fn` | read-only call (or published cell read: same wire op) |
| `actor.mutate!.value` | bang call, then a read-only call on its reply |
| `actor.mutate!...` | bang call, fire-and-forget |
| `actor.silent...` | silent call (`silent.`), fire-and-forget |
| `actor.mutate!(args)...` | bang call with args, fire-and-forget |
| `actor.silent(args)...` | silent call with args |
| `fn`, `@fn`, `fn!` | the same, on self |

`fn()` stays legal. Parens are optional, not retired.

## Silent calls never write the dot

At a call site the trailing `...` stands for the silent dot, as it already did
right after a name (`fn...`). It extends to calls with args:

- `fn(args)...` calls `fn.`. Unambiguous: `...` is illegal on a value-returning
  call, and a bang call keeps its `!`. `fn` and `fn.` may still coexist.
- `fn.(args)...` is an error: "write `fn(args)...`".
- `fn.()...` is an error: "write `fn...`".
- `fn....` stays an error ("write `fn...`").
- `actor.silent.` is not a call: it fails to document fire-and-forget. It stays
  the read of a silent reference field (`c.press.`, 10-30).

The dot is written only in declarations, docs, wire op names and silent
reference-field names.

## References need `&`

A bare function name is now a call. The function itself is `&f`, consistent
with `&` elsewhere: bare `x` evaluates (a cell's current value), `&x` refers
without evaluating (a live read-ref). Retired:

- `g = f` for a function-valued `f`: it now calls `f`.
- `f as Function`: write `&f`.

`&` is required, not inferred from a `Function`-typed slot: a zero-arity
function returning a function would make a bare `f` there mean two things. The
existing "use `&double`" errors in typed slots already enforce this.

**A member's function is `&svc.foo`**, not `svc.&foo`. Nothing reaches a
member function as a value today: `&` takes only a bare local name (`&double`,
`&top`), and `&svc.foo` lexes as `&svc` then `.foo`. The prefix covers the whole
path, as `*` does in `*Point(1, 2)`. `&c.count` on a published cell is then its
live read-ref, the same op, so `&` means "don't evaluate" whatever the member
is. A sigil in the middle of a path would be new.
`&(svc.foo)` means the same: the parens only group, and `&svc.foo` doesn't need
them.

Why `&` takes the whole path and not just `svc`: the only other reading,
`(&svc).foo`, gives nothing new. A function or an address, taken as one, has no
members, so nothing can be chained on it. For `&x` on a cell, the
capability-sigils rule says `&` only narrows (`*X` → `&X`), so `(&x).foo` would
be `x.foo` with writes refused. A read-only call through it is the same call,
and a `foo!` would be an error. No one needs that at a call site.

Edges:

- **One hop only, in v1.** `&a.b.c` would evaluate `a.b` (a call, now that
  parens are optional) and leave only `.c` unevaluated, which is easy to
  misread. Error: "bind the receiver first". `&name.member` and `&@pub` are the
  forms allowed.
- **A value field has no reference.** `&v.x` on a type's value field is an
  error: read it.
- **A reference field already holds a function.** `v.ref` reads it, so `&v.ref`
  is redundant: error, write `v.ref`.
- **`&svc` alone** stays what capability sigils say: a class actor is already a
  reference, so `&` adds nothing. Silent and bang members keep
their suffix: `&svc.log.`, `&svc.push!`. Follow-up; this ticket doesn't need it.

A reference field in a type (`ref: () -> (T)`) is data: `v.ref` reads the field,
`v.ref()` calls it. Unchanged.

## Found before implementing (JS, 2026-11-06)

| Source | Today |
|---|---|
| `c.total` (class actor, typed bind) | works |
| `c.inc...` (silent member) | works |
| `get` (local, bare) | compiles; fails at run time (read as a function value) |
| `@get` (own public, bare) | compiles to invalid JS |
| `bump!` (local bang, bare statement) | not treated as a call |
| `C().inc!.inc!.total` | compile error (untyped temp) |
| `c.inc!...` | lexed as `inc!.` + `..`: "no method 'inc!.'" |
| `c.add(2)...` for silent `add.` | "no method 'add'" |

Migration: ~85 `.(…)...` / `.()...` sites in tests and docs; `as Function` and
function aliasing in `__tests__/functions/higher_order.test.js`.

## Implementation

- **Parser.** `...` fills in the dot (`elidedDot`) and keeps a `!`; a dotted call
  with parens is an error naming the fix. A `!` member without parens, and any
  member of a `!` call's reply, is a `DotCallExpr` (both member parsers: the
  expression one and the reply-field one). A class body takes `obj.m...` and a
  bare `obj.m!` as statements. `return &f` parses.
- **`src/bare_calls.js`.** `lowerBareCalls` (first thing in `validate`): a bare
  name of the actor's functions (inherited too) or of a local bound to a
  function literal becomes a call, in expressions, positional and `:name`
  return fields, and a mid-body bare statement. Names the function declares,
  cells and subscription targets are left alone. `lowerBareMemberCalls` (after
  the docs are parsed): a member of a construction, of a local bound to one or
  typed as a class, or a function in a dependency's doc, is a call.
- **`settleElidedDots`** (`validate.js`) drops the filled-in dot again for a
  foreign function silent by its doc under a plain name, and for a local or
  param holding a silent function.
- **Erlang:** `&f` on a local lambda is its label. It was wrapped as a
  one-argument fun, so `g = &f; g()` failed (pre-existing; `as Function` hid it).
- **Rust:** a local function whose tail is `&inner` is inlined like one ending
  in `inner as Function`.
- **Migrated:** 85 `.(…)...` / `.()...` sites in tests and docs;
  `higher_order.test.js` from `as Function` to `&f`. The tests of the retired
  forms (`as Function`, `g = f`) are now error tests.
  `core_types/structure.test.js`: `Object(fn: f)` stored the result of `f`, so it's
  `Object(fn: &f)`.

Tests: `__tests__/functions/zero_arity.test.js`, plus new cases in
`silent_dot.test.js` and `higher_order.test.js`.

Gaps, same with parens (not this ticket): `return c.total + 1` needs an
annotation; a `repeat while (c.total() < 6)` poll on a child fails on JS.
