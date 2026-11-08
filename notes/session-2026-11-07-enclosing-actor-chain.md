# Session 2026-11-07: a class closes over the actors it's declared in

Two tickets in one change:

- **"A class declared inside a class closes over the classes that enclose it, up to the file."**
- **"A class's reads reach the right file actor, whenever the class runs."** Its three cases:
  - **Erlang, idle file actor.** Already fixed by `fb42570`. See
    `session-2026-11-03-stdin-one-reader.md`.
  - **Rust, `Self()` file actors.** Fixed here by the same per-instance chain the nested-class
    ticket needs.
  - **A file cell holding an actor.** Broken on Rust and Erlang, even in the file's own handlers.
    Fixed here.

Builds on `session-2026-11-03-class-reads-file-cells.md`.

## Decision: a chain of enclosing actors

A class closes over its enclosing class, that class's enclosing class, and so on out to the file.
The file is the outermost actor in the chain. A name resolves to its innermost declaration: the
class itself first, then each enclosing class outward, then the file. Function params keep their
exception.

The chain is made of actors, not declarations. An `Inner` that the `Outer` actor o1 constructs
reads o1's cells wherever and whenever it runs. Each read is a message to the actor that owns the
name, and that actor answers while it waits.

```brevity
total *Integer = 1

@Outer = (n Integer) *{
  count *Integer = n

  Inner = *{
    @get = { return count + total }   // count is Outer's, total is the file's
  }

  @make = { i = Inner(); x Integer = i.get(); return x }
}
```

## Compile errors

- **A name from a class outside the chain.** For example a sibling's cell, a cell of a class nested
  in a sibling, or a cell of a class nested inside this one: `'x' is a name of 'A', which 'B' isn't
  declared in`.
- **Constructing a class from outside the class it's declared in:** `'In' is declared inside 'A',
  so only that class and the classes inside it can construct it`. The file can't construct it
  either.
- **A public class declared in a class:** `'@In' is declared inside 'A', and a class declared in a
  class can't be public yet`. Its wire address (`#new` to `@Outer/1 @In`?) isn't designed yet.
- **Calling an enclosing class's function** is refused, as calling a file function already was. It
  waits for the writes-and-calls ticket.
- **Two classes of the same name anywhere in a file**, nested or not, are already refused by
  `renamePublicClasses` (`Class 'X' is declared more than once`). Nested classes are hoisted to the
  file's flat class list, so two `Outer`s can't each have an `Inner` yet.

**Not done: a name nothing declares.** It still compiles everywhere, the file included, and then
fails at runtime. Making that a compile error is a language-wide check. It isn't specific to
nested classes.

## Code

- **`src/parser.js`:** `parseConstructorBody`, and the lineal named-actor form, used to drop
  `nested.nestedActors`. `hoistNested` now tags each class with `enclosing: <class name>` and adds
  it to the program's flat class list.
- **`src/outer_reads.js`:** `markOuterReads` resolves each read against `enclosingChain(program,
  actor)` and marks it with `outerLevel` (1 is the enclosing actor), `outerClass` (null for the
  file), `outerParam` and `outerType`. It also visits the file actor, to check class construction.
  It exports `outerNamesFor` (typing, innermost wins), `classVisibleFrom` and `enclosesClasses`.
- **JS:** a binding carries `chain`, innermost first. `childBinding(ctx, cls)` slices the new
  class's chain from this actor's at compile time: `[this, ...this.#chain]` when this actor
  encloses `cls`, or `this.#chain.slice(i)` when an outer one does. `#outerRead(name, level)` asks
  `this.#chain[level - 1]`. A class that encloses classes answers `get@` from its children, as the
  file actor does. `#outer` is still the file actor: everything a class sends still leaves through
  it.
- **Rust:**
  - `outer_states` holds `(owner, state)`, and `state_owner` names whose state is in
    `self.state` (`""` is the file, `self/N` a `Self()` actor, `<class>/N` a class actor).
    `enter_state` and `leave_state` replace every swap.
  - `child_<c>_init_at` stores `__outers`, the instance's chain of owners. `outers_for(enclosing)`
    builds it from the constructor's own chain, at runtime, by class.
  - `outer_read(level, key)` finds the owner's state: in `self.state`, on the stack, or in its
    pool (`state_of`). The bottom of the stack is no longer assumed to be the file.
  - Keys are the owner's: `<class>_b_x` for a class cell, and no prefix for a file name or a
    class param.
- **Erlang:**
  - `bv_outer_ctx_(Enclosing)` passes `{FileActor, SeqRef, Chain}`, and the chain is a list of
    `{Class, Pid}`. `bv_outer_get_(Level, Key)` asks that pid.
  - `bv_loop_<c>` answers `bv_outer_get`, and every wait already does, since `serveClasses` is
    shared. A class waiting on its file actor for a wire reply now answers too
    (`bv_await_line_from_`).
  - `bv_outer_` is still the file actor, for stdin, dependency calls and ids.

## Found on the way (fixed)

- **Rust and Erlang: a call on a file cell holding a class actor** (`counter *Counter = Counter()`,
  then `counter.get()`) went out on the wire, `to: "counter"`, even from the file's own handler.
  A cell typed with a class of the file now dispatches to that actor in-process. That's
  `child_<c>_dispatch_at` on Rust and `genErlRefCellSelfDispatch` on Erlang, which used to take
  only `Self`. It works on an enclosing actor's cell too. JS only needed the class read to go
  through `#outerRead`.
- **Rust: a file cell set from a file param** (`total *Integer = n`) didn't compile. main renamed
  `self.` to `actor.` before wrapping the value, so the wrapper no longer saw a `Value`.
- **Rust: a `Self()` actor didn't run its file's constructor block.** `self_init_at` set only the
  params. It now runs main's init lines against the swapped-in state.
- **Erlang: a file cell set from a file param was null.** The cells were initialised before the
  params were set, and the params were then reset to null. The params now come first.

## Tests

- **`__tests__/classes/enclosing_reads.test.js`:**
  - An inner class reads its enclosing class's cell and param, the file's cell, and a cell two
    classes up.
  - The innermost of two names wins.
  - Two `Outer` actors give their inner classes different values, after a write to one.
  - Every compile error above has a test.
- **`__tests__/classes/outer_reads.test.js`:**
  - "a class constructed by a Self() actor reads that actor".
  - "a file cell holding an actor", called by the file, then by a class after the file wrote to it.

All pass on js, Rust and Erlang, as do `__tests__/{classes,self,constructors}/` on all three.

## Known gaps

- **Erlang waits on an in-process launched call**, as before
  (`session-2026-11-03-stdin-one-reader.md`). It's an await question, not a reads one.
- **A public nested class** and **two nested classes of one name** need a design first.
- **A name nothing declares** still compiles. See above.
- **Rust, a class built while a `Self()` actor runs inside another class's dispatch.** The old
  `outer_states.first()` read the wrong state here. The owner lookup fixes it by construction,
  but no test builds that exact interleaving.
