# Session 2026-11-03: a class reads its file's cells

Resolves the gap in `session-2026-11-01-public-classes-across-files.md`: `total *Integer = 4` with
`@get = { return total }` in a class compiled, then failed at runtime on js. It didn't compile on
Rust or Erlang.

## Decision: a class closes over its file actor

A class reads the cells of the file actor it's declared in. It's its own actor, so each read is a
message to that actor, and sees the cell as it is at the time. So `Svc.W()` and `s.W()` differ:
`Svc.W()`'s actor reads the shared `Svc`'s cells, and `s.W()`'s reads `s`'s.

The deadlock worry doesn't apply. The file actor answers a read while it waits on anything, and it
is waiting whenever one of its classes is running for it. An actor that needs a value before it can
reply gets it, then replies.

```brevity
total *Integer = 4
@title *Text = "box"
k = 5

@W = *{
  seed *Integer = total          // read once, at construction
  @get = { return total }        // read on every call, so a later write is seen
  @sum = { return total + k }
  @param = (total Integer) { return total }   // a param of the same name is the param
}
```

- **Covered:** private cells, published cells (`@title`), constants (`k = 5`), file params, in a
  handler, a constructor block, a branch condition, a reply shorthand (`return total`, `return :total`),
  and through a subclass.
- **Lexical, not dynamic.** The outer actor is always the file actor, even when another class
  constructs the class.
- **A class's own name wins.** A class cell called `total` is the class's. The function-params
  exception to no-shadowing still applies.
- **Writes are still a compile error.** `total <- 2` in a class gives `Cannot set 'total' — only
  'ref' variables and actor references support '<-'`, as it did before. That message is misleading.
- **Calling a file's function from a class is now a compile error:** `'f' is a function of this
  file, and a class can't call it yet — pass what it needs as a class param`. That covers `f()` and
  `@f()`. Both used to compile, then fail at runtime on js and Erlang. A class's own `@f` is fine.

## Code

- **`src/outer_reads.js`**, called from `validate` before `lowerAs`. `markOuterReads` sets
  `outer: true` on each Identifier or RefRead in a class that names a file name, and gives
  reply shorthands an explicit expression. It also refuses file function calls.
  `fileOuterNames` gives each name's type, so every backend's class typing can include it.
- **JS:** every class gets `#outer` from its construction binding (`childBinding`): `this` from
  the file actor, `this.#outer` from a class. A read is `await this.#outerRead(name)`, which posts
  `{ op: 'get@total', from: '__child', _route }` to the file actor, and `#_outerGet` answers it.
- **Rust:** `child_<c>_init_at` and `_dispatch_at` push the state they swap out onto
  `outer_states`, rather than holding it in a local, and the first entry is the file's.
  `outer_read(key)` reads it, and falls back to `self.state` when nothing is swapped.
  `toJsonValue` counts `self.outer_read(` as already a Value.
- **Erlang:** `start_internal_<c>` takes the file actor's pid (`bv_outer_()`, which is `self()`
  in the file actor and inherited in a class). `bv_outer_get_(Key)` sends `{bv_outer_get, …}`.
  The file actor answers it in each wait: `bv_await_`, and the new `bv_await_ready_`,
  `bv_await_wire_` and `bv_await_emit_`.

## Tests

- **`__tests__/classes/outer_reads.test.js`:** wire tests through `#new` on `@W`, covering each
  read above, a write by the file seen afterwards, the constructor-block read staying as it was, an
  in-process construction, a subclass, and the compile errors.
- **`__tests__/classes/public_class_across_files.test.js`,** "Svc.W() and s.W() read different
  actors": two callers run end to end through a relay. The shared `Svc` has been bumped to 14, and
  `#new` to `Svc` creates a fresh actor at 4. `Svc.Reader().get()` gives `[14]` and
  `s.Reader().get()` gives `[4]`.

## Known gaps (from reading the code, not tested)

- **Erlang, when the file actor is idle.** Fixed: see `session-2026-11-03-stdin-one-reader.md`.
- **Rust, `Self()` file instances.** Fixed: see `session-2026-11-07-enclosing-actor-chain.md`.
- **A class declared inside a class.** Fixed: it closes over the chain of actors it's declared
  in. See `session-2026-11-07-enclosing-actor-chain.md`.
- **A file cell holding an actor.** Fixed on Rust and Erlang, and tested on every target. See
  `session-2026-11-07-enclosing-actor-chain.md`.
- **Calling file functions from a class** is the natural next step: a call to the file actor in
  place of a read. JS's `get@` route takes a function call with little change. Rust needs the
  file's state swapped back in for `handle_op`, and Erlang a `bv_dispatch` serve clause.
