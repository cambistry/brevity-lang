# Session 2026-11-03: the open effect rules, implemented

Implements "Settled 2026-11-03" in [mutation-suffix](mutation-suffix-2026-10-31.md),
plus the constructor-block and dependency gaps the work ran into. Uncommitted.

## The rules

1. **A fresh actor writes only itself.** A call on an actor created in the function,
   before it escapes, is exempt only if the function called writes nothing past its
   own actor. The same goes for a constructor's calls to its own functions, inherited
   ones included. `src/effects.js` now builds a context per actor, computes "reaches
   past its actor" for every function in the file to a fixed point, and only then runs
   the checks. A function's own cells (inherited too) and its own functions that
   don't reach out are its own; anything else reaches out. An emit isn't a write at all
   ([emit-not-a-write](emit-not-a-write-2026-11-03.md)). `d =
   c.inc!(5)` binds `d` to `c`'s class. A fresh actor of a dependency's class
   (`Svc.Counter(…)`, `Svc()`) always counts, since a doc can't say.
2. **A constructor follows the rules of a function.** A class named `!` whose
   constructor never writes is an error. Writing its own cells is setup and doesn't
   count. A param passed by reference (`(t *Integer)`) is someone else's cell. A
   subclass may be purer than a `!` member of a parent from a dependency's doc.
3. **An anonymous function in a `=>` slot follows the rules of a `!` function**, and
   what it yields must match the slot: `=> self` takes falling off the end, `=> (T)`
   needs `return` with a value, `=> .` returns nothing, and `=> ()` takes falling off
   the end. The rules moved from the parser to `src/writer_body.js`, used for named `!`
   functions at parse time and for these at effect-check time. An arrow-form tail write,
   `(i) -> a <- i`, stays a statement.
4. **A type field's name matches its arrow.** `=>` with a value or self means `run!`,
   `=> .` means `run.`, `->` and `~>` take a bare name, and a value field takes no
   suffix. `t.run!()` resolves on every target and counts as a write.
5. **`<-` as a value yields the cell's new value.** `settleWrites` moves each write in an
   expression into a statement just before the one using it, and reads the cell in its
   place. A write in an `if` branch stays on that branch; a one-line branch of an `if`
   used as a value takes the braced form. A write on the right of `??` is an error,
   since that part may not run.
6. **`untracked @log`** from inside its own actor has a test.

## Gaps found and fixed on the way

- **Constructor blocks couldn't call or write.** At the top of a body, a line starting
  with a name was read as a declaration: `@reg!(1)` and `n <- 1` were parse errors, and
  at file level `reg!()` silently turned the rest of the file into a class. Now
  `@name(…)`, `#name(…)`, a bare `name(…)` this body declares (above or below), and `<-` work on every
  target. A public constant (`@magic = "x"`) still can't be written. Rust and Erlang
  ignored these statements in setup; Erlang's file setup runs them after every cell and
  param is set. `x = @f()` at file level holds the one value. The inheritance merge was
  dropping a cell's initial value when a constructor wrote it.
- **A class couldn't call its file's dependencies on JS.** A class closes over its file
  actor (`session-2026-11-03-class-reads-file-cells.md`), and a dependency in the
  header is the file actor's, so the class asks the file actor to make the call through
  `#outer`, with a reply route back, as for a read. Rust dropped such a call from a
  constructor.
- **A silent dependency call hung on JS.** `Svc.note.()...` waited for a reply that never
  comes. A test in `cam/remote_instance.test.js` fed replies to silent calls; those steps
  are gone.
- **Launching your own public silent function,** `@write.("x")...`, never compiled.
- **Rust didn't wait on a call used as a statement,** `Svc.ping!()`, to a dependency or
  a remote instance. It does now, unless the call is silent. JS already did.
- **Rust compiled `n Integer = run(() -> { … })` to `Value::Null`** when the lambda had
  more than one statement: the inlining path only knew a one-expression lambda. Such a
  call now takes the general path.

- **Erlang didn't wait on a call used as a statement** either. It does now (`bcdc63a`).
  `cam/remote_instance.test.js` shows it on every target despite Rust's replaying harness:
  a bump that arrives while `@go!` waits on `Svc` is handled first, so `@go!` returns 1.
  That also pins down that an actor answers other messages while it waits.
- **A class's outgoing messages are its file actor's, on every target.** On JS a class
  posted to whichever actor constructed it, so only calls on a dependency named directly
  worked; constructing a dependency's class (`Svc.Thing()`) or calling an actor got that
  way was "unhandled". Now everything a JS class sends to anyone else (`#send`, `#fire`,
  `#sendRef`, `#sendNew`) leaves through `#out`: the file actor sends it under its own id
  and routes the reply back. Every class gets `#outer`. On Erlang a class process sent
  under its own counter, so its ids collided with the file actor's; the file actor and its
  classes now share one counter (`bv_next_seq_`, an `atomics` passed down at spawn), and a
  call on a dependency named directly goes through the file actor (`bv_outer_call_`). Rust
  needs nothing: a class shares its file actor's struct. `constructor_block.test.js`
  checks the ids on every target.
- **A launched call didn't know it was launched.** Validation now marks every `…...` call
  (`launched`), so a doc's silent function without its dot, or `ping!()...`, doesn't wait
  on any target. Constructor blocks are checked too.
- **JS dispatched a reply nobody was waiting for** as an op, and threw. It drops it now.
- **A function silent by its doc,** `log (Text) => .`, needs its `...` like one named
  `note.`. Without it the call waited for a reply nothing sends.

## Known gaps

Ticketed separately: calls to an undeclared own function (`@nope(1)`) aren't reported;
the Rust test harness can't show that a call waits; an unannotated `x = @f()` is
`Anything`, since types aren't inferred through calls.

## Tests

New `__tests__/classes/constructor_block.test.js`. In `__tests__/functions/bang.test.js`:
fresh actors, `=>` slots, field names, `<-` as a value, `untracked @log`. In
`services/actor_interface.test.js`: the constructor rules. `!`-class fixtures in
`bang`, `actor_interface`, `public_class` and `public_class_across_files` now write
while constructing, through a silent dependency call, and their runtime tests expect
that message. Functions that now count as writers were renamed with `!` (`peer`,
`public_class_across_files`).

JS: every project directory except `browser`'s own project is green (161 suites).
