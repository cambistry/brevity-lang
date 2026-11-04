# Session 2026-11-03: stdin has one reader (Erlang)

Fixes the first known gap in `session-2026-11-03-class-reads-file-cells.md`: on Erlang, a class
couldn't reach its file actor while the file actor was idle.

## The problem

A class asks its file actor to read a file cell (`bv_outer_get_`) and to call a file dependency
(`bv_outer_call_`). The file actor answered only in its waits (`bv_await_`, `bv_await_ready_`,
`bv_await_wire_`, `bv_await_emit_`). Idle, it was blocked in `io:get_line` in `read_loop`, so
nothing answered, and the class hung. A subscription callback is the case that shows it: the file
actor sends the callback to the class and doesn't wait.

A class waiting on its own wire reply (a `#new` to a dependency's class, a call on an actor it
holds) also read stdin itself, against its file actor reading the same stdin.

## Decision: the file actor is stdin's one reader

- **It asks for a line without blocking.** `bv_want_line_` sends the io protocol's own
  `{get_line, unicode, ""}` request to the group leader and keeps its ref. The reply is a message
  (`{io_reply, Ref, Data}`), so the same receive can serve classes. At most one request is out,
  and only while someone wants a line.
- **Every wait serves classes.** `serveClasses(loop)` in `preambles.js` gives each wait the same
  three clauses: a cell read, a dependency call, and `{bv_await_line, Pid, Id}`, a class waiting
  on a reply. The idle wait (`bv_next_line_`, called by `read_loop`) has them too.
- **Classes never read stdin.** `await_response_` and `await_new_response_` both go through
  `bv_await_line_(Id)`. In a class, that asks the file actor and waits for `{bv_line, Id, Msg}`.
  In the file actor, it asks for lines and handles each as `await_response_` used to: its own
  reply returns, another reply is dropped, and anything else is dispatched.
- **A reply goes to whoever waits on it.** `bv_take_line_` gives a `re` or `ex` whose id a class
  registered to that class. The file actor gets everything else.
- **A line that comes during another wait is kept.** In the `bv_await_*` waits, a line that
  isn't a class's goes on `bv_line_q_` for `read_loop`. Another line is asked for only while a
  class still waits on one.
- **"Ready" still means everything is waiting on input.** The test router emits `ready` when a
  get_line request reaches it. The subscription callbacks the file actor sends without waiting now
  go through `bv_launch_`, which records the id. The idle wait asks for a line only once they've
  all replied, unless a class is waiting on the wire too. So the callback's output comes before
  `ready`, not after.

## Code

- **`src/codegen/erlang/preambles.js`:** `serveClasses`, `asideLine`, and the stdin section
  (`bv_want_line_`, `bv_take_line_`, `bv_line_aside_`, `bv_await_line_`, `bv_next_line_`,
  `bv_launch_`). `await_response_` and `await_new_response_` are now thin over `bv_await_line_`.
- **`src/codegen/erlang/program.js`:** `read_loop` takes its next message from `bv_next_line_`.
- **`src/codegen/erlang/statements.js`, `expressions.js`:** subscription callbacks go through
  `bv_launch_`.
- **`src/codegen/erlang/brevity_router.erl`:** the group leader writes output while a read is
  pending (it used to block in `gl_wait_input` until input came), and keeps pending reads in a
  queue. `index.js` recompiles the router's beam when its source is newer.

## Found on the way (fixed)

- **Erlang and Rust: a class with no functions wasn't a class.** `Reader = (:P *Integer) *{ … }`
  with only a subscription failed to compile (`variable 'Reader' is unbound` / `cannot find value
  'Reader'`): the active-actor filter kept only actors with public functions. Every named class
  is now active.
- **Erlang: a subscription on a param wasn't registered when the arg was `@n`** and the class was
  constructed in a handler. The statement path only took an `Identifier`; it now takes a
  `RefRead`, as the expression path did.
- **JS: a launched call, or a call to a silent function, on a child waited for a reply** that a
  silent function never sends. It's now `#childFire`, which doesn't wait.
- **JS: an expression statement in a lambda body was dropped.** `genFunctionBodyCode` had no
  `ExprStatement` branch, so `P.subscribe (v) { Svc.note.(v)... }` did nothing.

## Tests

`__tests__/classes/outer_reads.test.js`, "a class reaches its file actor while the file actor is
idle": a launched call that reads a file cell, one that calls a file dependency, and a
subscription callback that does each. They pass on js, Rust and Erlang. With the class clauses
taken out of `bv_next_line_`, both subscription tests time out on Erlang.

## Known gaps

- **Erlang waits on an in-process launched call.** `w.read.()...` goes through
  `genErlSelfSpawnedDispatch`, which awaits it, so the file actor isn't idle there. That's why the
  launched tests pass with or without this fix. JS doesn't wait.
- **JS: subscribing to a file's private cell from a class** (`Reader(P: n)` with `n` private)
  subscribes to `@n`, which the file actor doesn't have. The `ex` it gets back then fails with
  `pending.reject is not a function`, since a subscription's pending entry has no `reject`. The
  tests use a published `@n`.
- **`Self()`-spawned file instances** have no outer actor, so they ask the group leader for lines
  themselves, as before. The router now queues their requests rather than dropping one.
