# Session 2026-11-02: tags on instance calls

A call to an instance from outside now behaves like a call to a file handler on all three targets, on
the way in and on the way out.

## Calls in

| Call to `@typed = (i Integer)` | Answer |
|---|---|
| `['x']` tagged `Text` (honest, wrong) | `unhandled` |
| `[1]` tagged `Text` (a lie, value would fit) | `unhandled` |
| `['x']` tagged `Integer` (a lie) | `as Integer: got Text` |
| `['x']` with no tag | `schema_required` |
| an op it doesn't have | `unhandled` |

The tag picks the clause and the value is then checked against it, so a tag that's wrong in either
direction never reaches the body as that type. On Rust and Erlang a tag picks the overload too. Before,
the first clause always ran.

In-process calls carry values, not tags, so they stay exempt, as on JS.

**An `Anything` param takes any tag,** on every target and in file handlers too. This closes the open
bug from `session-2026-11-01-as-renders-or-fails.md`. It had to go with this change: instances on Rust
and Erlang accepted these calls only because they checked nothing, and would otherwise have started
refusing them.

## Leaving out every arg

A handler with nothing required takes a call with no args and no tags, so `@opt = (i Integer = 1)`
called as a bare `@opt` uses its default. This covers file handlers too, where it answered `unhandled` on
every target, though a named optional and `bv-a: [[]]` already reached the default.

The check is in codegen, not the matchers: no tags, or a tag match, when no param is required. That
counts params the matchers skip, so `(l List, i Integer = 1)` still answers `unhandled`. Args with no tags
still get `schema_required`, which runs first.

## Replies out

Rust and Erlang instances replied with no `bv-a` at all, so a receiver saw a tag from a JS instance and
none from the others. Replies to a call from outside now carry the handler's tag, per path.

`if c { return "x" }; return 9` itself was already right on JS: `pathTag`, in `e848c43`. It had no
tests. They're in `__tests__/functions/return_shapes.test.js`, and it was the class half of those tests
that needed Rust and Erlang to tag at all.

In-process replies are unchanged: there's no tag channel, so the parent gets decoded values.

## Code

- **Erlang:** `bv_forward_` sends `{bv_dispatch_wire, …}` with the whole message, and the handler sees
  `From = <<"__bv_wire">>`. Only that `From` is checked (`instance: true` in `genPublicFnInner`). A name
  with typed params or overloads tries each clause in its own function (`child_x_clause_N_M`), since
  a `case` per clause would leak its bindings into the next. The reply is
  `{bv_wire_reply, Id, Re, Bva}`, in wire form.
- **Rust:** handlers return only a value, so the call lives on the actor: `wire_msg` holds the message
  the guards read, and handlers set `wire_tag` and `wire_unhandled`. A call that arrives while another
  waits on a reply restores `wire_msg` afterwards. `childTagGuard` puts the check on the match arm, so
  overloads fall through, and `bv_from_wire_caller` is the exemption.
- **Rust, fixed on the way:** a handler whose tail is `if b { return 1 } else { return 2 }` didn't build
  in a class. `schema_required` from an instance left out `from`.

## Open

- **A bare value in a tail branch:** `if b { "x" } else { 9 }` in a handler replies `{}` on JS and doesn't
  build on Rust. Erlang replies `["x"]`, untagged.
- **Rust, an implicit tail after a guard:** `if b { return "x" }; 9` in a file handler replies `[]`. JS and
  Erlang reply `[9]`. Replies this way carry no tag on any target.
- **Same-arity overloads called in-process:** the first clause whose arity fits runs on every target, as
  no tags exist to choose by. A value of the second clause's type then fails its `as`. Read from the code,
  not run.

## Verification

The 27 test files touching instances, `Anything`, `Self()` or subscriptions, on JS, Rust and Erlang: 674
tests pass on each. ESLint is clean on `src/` and the changed tests. The full suites and browser weren't run.
