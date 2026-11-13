# Protected names on the wire: a leading `.` — 2026-11-11

> **Spelling superseded 2026-11-12:** a protected name's wire prefix is `~`, not `.` (`~val`,
> `~helper`), public names travel bare, and a cell is set by `{op: [[v], '$set'], to: '. ~val'}`.
> See `at-sigil-internal-and-quoted-names-2026-11-12.md`. The scope below stands.

Design decision, wire level only. An actor's internal traffic is a set of messages in name only.
This is the first step toward making those messages real.

## The convention

A protected (bare) name on the wire takes a leading `.`:

```
{op: [[1], "#set"], to: ".val"}     // set protected cell `val`: an actor-internal bus message
{op: ".helper"}                     // call protected function `helper`
```

| Source label | Tier      | Wire            |
|--------------|-----------|-----------------|
| `a`          | protected | `.a`            |
| `@a`         | public    | `@a`            |
| `#a`         | private   | `#a`            |

- **The dot means public in source but protected on the wire.** In source, `x.val` on another
  actor is that actor's `@val` (wire `@a` is consumed as `.a`). On the wire, `.val` is the
  protected label. These are two spellings at two levels. Neither is reinterpreted.
- **A leading `.` is local under the existing rule** (a leading delimiter means local; a leading
  word character means global). Before this, a protected label couldn't lead a relative address,
  because a bare word reads as global (see `classes-as-singletons-2026-11-09.md`). Now it can.
- **A leading `.` is free on the wire.** The only dots in use are the silent return type `.` and
  the trailing silent suffix (`note.`).
- **This doesn't change what the source says.** It changes only how messages already sent are
  spelled, plus a `set` path for protected cells.

## What it replaces

Today, in all three targets:

- **Protected and private functions are self-sends** with the op `"helper"` / `"#secret"` and no
  `to`. A check on `from` keeps them off the wire:
  - JS and Rust accept `__parent`, `__self`, `__test` and `__emit`.
  - Erlang also accepts `__bv_internal`.

  So "internal" is a claim the sender makes; nothing in the name or address carries it.
- **A protected cell has no `set` path.** The JS set/subscribe selector only matches
  `(@|#)name`, and only public cells get a `set@x` arm.
- **Subscriber tables strip the sigil.**
  - **JS:** wire subscribers to `@a` are keyed `"a"`.
  - **Rust:** wire subscribers to `@a` are keyed `"a"`. Protected `a` has a separate in-process
    table, also keyed `"a"`.
  - **Erlang:** wire subscribers to `@a` and in-process subscribers to protected `a` share one
    `{cell_subs, <<"a">>}` list, told apart only by tuple shape.
- **Snapshots** key state as `"val"` and `"@pub"`.

## Scope

In:

- **Self-send ops for protected functions:** `".helper"`. This covers lambda labels
  (`._lambda_N`), since a protected function held as a value is its op label. The dispatch arms
  and their guards follow.
- **`set` for a protected cell:** `{op: [[v], "#set"], to: ".val"}` is answered internally only.
  The selector learns `.` (`[.@#]name`).
- **Subscriber tables:** keyed by the full label (`".a"`, `"@a"`), one key space per actor, in
  every target.
- **Snapshot keys:** capture/hydrate use `".val"`.

### How it lands

- **One mapping, `wireLabel(name)`** (`src/codegen/wire_labels.js`), shared by every target. A
  name that already starts with `@`, `#` or `.` is left alone. So is an intrinsic op or arm
  (`set`, `update`, `new`, `as`, `get`, `subscribe`, and the `set@x` / `set.x` / `new@X` forms).
  Anything else gains the dot.
- **Inside the actor, a source name stays bare.** Calls, `actorFnNames`, state keys and
  capture-field identifiers (`_cap__lambda_N_v`) keep the source name. Only the op string, the
  label value and the wire key carry the dot.
- **The protected setter is `set.val`,** synthesized at parse time beside the public `set@val`. It
  exists for the same cells: value types, and references to `Self`. Because it doesn't start with
  `@`, it is guarded as private. From outside, the answer is `ex: {"set.val": "unhandled"}`.
  Erlang and Rust names derived from it spell the inner `.` as `_d_`.
- **A bare `to: "val"`** names nothing: `set` is unhandled.
- **In-process subscriptions** (a class subscribed to a host cell through a constructor param) are
  keyed by the cell's wire label too. So a protected `a` (`.a`) and a public `@a` no longer share
  a list.
- **`test.op` forwards `to`,** so the harness can send the bus message from inside.

Out:

- **What `<-` on a protected cell compiles to.** It stays a direct store in every target. Whether
  it should go through the bus is a separate and much bigger question.
- **Who may send internal messages.** The pseudo-sender check stays as it is, `__parent`'s access
  to a child's protected and private ops included.
- **Intrinsic op spellings.** `get@x` / `set@x` and the internal `set` / `update` ops keep their
  names. Only the label they carry gains the dot.

## Open

- **Private on the bus.** `#a` is already distinct on the wire, but the same `from` check guards
  it, so a private label isn't actually private on the wire.
- **Who answers `to: ".val"`.** In-process, a child of the actor holding the cell? Or only the
  actor itself? This is the first case where the bus has a real address.
