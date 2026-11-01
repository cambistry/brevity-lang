# Session 2026-10-31: `!` functions and `<-` chains

Implements phases 1-2 of [mutation-suffix](mutation-suffix-2026-10-31.md). Uncommitted
for review. Enforcement that a writer carries `!` is phase 4, so existing code is
unaffected.

## Language

- **Names:** `!` glued to a name is part of it (`inc!`, `@inc!`, `#inc!`), and `a!=b`
  is still not-equal. A type name takes no `!`.
- **Bodies:** `settleBangDecls` applies the note's rules 1-6. No tail return, falling
  off the end returns self, `return v` returns `v`, and tail values, a bare tail
  `self` and value-or-fall-through paths are errors. Rule 7 and the error for a tail
  call to a reader need effect inference, so they wait for phase 4.
- **Bare `return` in a `!` function:** exits as falling off the end does, returning
  self. The note didn't specify this; decided here.
- **`self`:** a value in return position only. `return self, 7` and `x = self` are
  errors. A tail `self` in a read-only function is an ordinary tail return.
- **Signatures:** `-> self`, in function types, interfaces and generated docs.
  `-> (self)` is an error, and the DOM manifest moved over.
- **`<-`:** `a <- b <- c` spreads into `a <- b` then `a <- c`, also with `<|`. A write
  used as a value parses and reports a compile error, because `return *acc` doesn't
  exist (open decision 2).

## Wire

A self-return is `{ re: {}, 'bv-a': '#<>' }`. Both translators promote `#<>` to
`#<addr>`. They also disagreed on `:` (`runtime.js` matched only `[@#]`, so it left
`#<::Point>` alone), and now match the same set. The DOM runtime replies with the
element's address. The self-dispatch checks treat `#<>` as "me".

## Chaining

`c.a().b()` compiled to broken code before (`#send(op, undefined)`), so this is new.

- **JS:** `#childSendChain` and `#childSendRead` take the receiver at runtime: a child
  handle or an address.
- **Rust, Erlang:** `src/chains.js` hoists each receiver into a temp, so each call in a
  chain is a plain call on a bound name. A temp or local bound to a `!` call becomes a
  handle when every path of that function returns self. Parents translate a child's
  self-return into their handle: the instance ref on Rust, the pid on Erlang.
- **Remote replies:** `await_response` on Rust and Erlang, and the pending path on JS,
  turn a self-reply into its address.

## Fixed on the way

- **Rust:** `a <- privateFn(x)` failed to compile with a double `self` borrow.
- **Erlang:** `if c { return acc }` on a state cell referenced an unbound variable, and
  an early return dropped its `bv-a` tag. It now carries it, as on JS and Rust.
- **All targets:** a self-call mid-body (`@bump(1)` then more statements) was silently
  dropped. It's now a statement.
- **JS:** a delegated body had one tag for all its paths. A body with a self-return now
  picks the tag per path.

## Typed replies decoded by tag

A typed value travels in wire form with a tag in `bv-a`. Inbound requests decoded it,
but replies didn't, so `i Item = c.pop()` then `i.name` failed on every target
(confirmed on a clean `HEAD`). A reply's `re` is now decoded against its `bv-a`, per
slot or per key, for a caller that declares the type: `_bv_unwire_reply` on JS,
`bv_unwire_reply` on Rust and Erlang. It runs where replies arrive (the JS pending
path, `await_response` on Rust and Erlang, the Erlang instance loops). A Rust child has
no `bv-a` channel in process, so its arms decode when `from` is `__parent`.

## Early returns and branches (existing bugs, all data loss)

Found while testing the above. None of these is specific to `!`.

- **Rust:** an early `return` in a child class's function was ignored. The child arm
  had no guard handling, so `if c { return 1 }` fell through to the tail. The guard
  generator is now shared (`rustGuardBlock`).
- **Rust, Erlang:** a write or call in a branch that returns was silently dropped:
  `if c { acc <- 1; return v }` returned `v` without writing.
- **Erlang:** an `else if` in a returning `if` was ignored.
- **JS:** a call in a returning `if` branch was dropped.
- **Rust:** `n Text = i.name` on a typed value didn't compile, missing its conversion.

A tail `if` in a `!` function now returns self explicitly from each branch, so every
backend uses that one early-return form.

## Known gaps

- **`<-` as a value:** see open decision 2.
- **Chain on a value:** a `!` call on a class in this file that returns a value can't be
  chained on, which is a compile error: bind it first. The check sees constructions and
  locals bound to one. Elsewhere JS reports a runtime error, and Rust and Erlang fail to
  compile. A remote's `!` is assumed to return self in a chain, so a remote that returns
  a value misroutes the next call on Rust and Erlang. Phase 3 can check `-> self`.
- **Chain from a call on this actor:** see "References and self-calls" below.
- **Classes named with `!`:** see "Generated docs" below. File constructors are covered in
  the design note.
- **Value paths of different shapes:** a doc shows one, preferring the function's own level
  over a branch: `f (Boolean) -> (Text)` for `if b { return 1 }; return "x"`. Consumers
  read one return shape, so stating more needs a decision about how callers check them.
- **Constructing a public class from another file:** done, see
  [session-2026-11-01](session-2026-11-01-public-classes-across-files.md).
- **Writing a published cell from its own actor:** `@a *Integer = 3` with `a <- a + 1` in a
  function reports "Cannot set 'a'", and `@a <- …` reports "The left side of '<-' must be a
  cell", with or without inheritance. Setting it from outside (`s.a <- 9`) works.

## Tests

New `__tests__/functions/bang.test.js` and `__tests__/types/type_reply_decode.test.js`,
with validation tests separate from runtime tests and 5 runtime fixtures in all, to keep
Rust builds down. Fixture functions that write carry `!` already, so phase 4 won't need
to migrate them. Plus a translation test in
`__tests__/browser/closure_child.browser.test.js`. Element browser tests assert the new
address tag.

## Phase 3: effect arrows

Docs and function types state effects in the arrow, never the name. `->` reads, `=>`
writes, `~>` purports to read; the table is in the
[design note](mutation-suffix-2026-10-31.md).

- **Lexer:** `=>` and `~>` lex as arrow tokens carrying their spelling, so existing
  lookaheads hold. `consume` rejects them outside signatures, so `(i) => i` is an error.
- **Parser and `parseInterface`:** entries record `effect`. `-> .`, `~> .` and `~> self`
  are errors. A foreign silent function may omit the dot, which sets `silent` on its
  entry, so `Logger.log("x")...` is accepted.
- **Generated docs:** `!` gets `=>`, a silent function gets `=> .`, and `@me = { self }`
  gets `-> self`.
- **Manifest:** bang entries and silent entries moved to `=>`. Queries stay `->`.
- **`untracked`:** parsed on doc entries into `__untracked`, for phase 4. It's reserved
  for locals only: `@untracked`, `#untracked`, members, keys and a doc entry
  `untracked (…)` are fine.
- **Migration:** `-> .` became `=> .` in type positions across tests and docs. `emit`
  declarations too. Silent lambda bodies (`(e) -> .`) are unchanged.

Nothing reads `effect` yet; phase 4 does.

## Phase 4: enforcement

`src/effects.js` runs at the end of `validate`.

- **Errors:** a writer without `!` or `.`; a `!` function that never writes, unless it
  overrides one; a discarded read with a value to lose; a writing function in a `->`
  param; an `untracked` function writing tracked state; a class writing during
  construction without `!`; a file constructor whose alias and arrow disagree.
- **Not writes:** local cells, writes to an actor created in this function before it
  escapes, and anything `untracked`.
- **Spreading `~>`:** a function reading a `~>` in an inline doc gets `~>` in its own
  generated doc, following calls across the whole file (own functions, class fields,
  locals, typed params, fresh constructions and chains) until nothing changes. `!` and
  `.` keep `=>`. A `~>` call is reason enough for `!`. A doc supplied through
  `options.remotes` isn't seen by generated docs, because they come from `extract`,
  before remotes exist.
- **`untracked` in source:** on cells, functions and nested actors, and in generated docs.
- **Backends:** local functions named `fn!` needed sanitizing on JS and Erlang.
- **Migration:** about 90 functions across 26 test files gained `!`, by a throwaway script
  run in report, rename, re-report rounds.

## Known gaps in phase 4

- **`~>` warnings aren't built:** a `!` or `.` function resting only on a `~>` compiles
  silently, for want of a warning channel.
- **A non-public class's members leak into the file's doc.** `C = *{ @g = … }` lists `g` at
  the top level, with no entry for `C`, though the file has no such op. Existing behaviour,
  also on `92e6eda`.

- **The add_child warning isn't built:** there's no warning channel.
- **Remote constructions count as fresh:** `t = Thing()` inside a function exempts writes
  to `t` until it escapes, including for a dependency the note doesn't address.
- **`->` slots on imported types aren't checked,** and neither are slots on a class reached
  through a chain, or on an overloaded function.
- **Discarded reads inside a nested function aren't checked.**
- **Published cells can't be written from inside.** `@log *Text` has no inside-write form
  (`log <- x` and `@log <- x` are both errors, also before this work), so `untracked @log`
  is only useful for writes from other actors.

## Private classes in service docs (2026-11-01)

A private class no longer appears in the generated service doc. A public class inheriting from one states the inherited params and members in place, since `...T` would have no entry to expand from; a public ancestor behind it stays a spread.

Writing the tests exposed a phase 4 bug: `src/effects.js` looked classes up by declared name, so public classes (`@C`) were never found when called as `C`. Claims didn't spread through them, overriding a public parent's `!` was rejected, and writing a fresh public actor counted as a write. Fixed with `classesByName`.

## Closing the gaps in effect checks (2026-11-01)

- **`!` functions declared in a body** now follow the same rules as file-level ones. A write to the enclosing function's own cell needs `!` on the name, but doesn't make the enclosing function a writer. A write past it, including to a fresh actor the enclosing function holds, counts for the name.
- **`->` slots** are checked on type fields, class params (inherited too), class methods, and doc params, and the slot's own arrow is read, not one nested in its params or result.
- **Discarded reads** are caught on typed params and class params, and on inherited members.

Requiring `return` in nested `!` functions exposed an older bug on all targets: `return a` from a nested function, where `a` is the enclosing function's cell, failed, while `{ a }` worked. The parser now marks that field as a cell read, the JS and Erlang capture scanners read both field forms (they only looked at `f.value`, and positional fields use `f.expr`), and the Rust and Erlang nested returns prefer `f.expr` over the name.

## References and self-calls (2026-11-01)

- **`&name!` is the reference form,** matching `&name.`. A bare name still gets "use `&bump!`", now in `return` too. A `->` slot rejects a writer named by reference, as it does an inline one.
- **The reported crash wasn't about `!`.** A function named `take` was parsed as the builtin `Text.take`, so the call was missing an argument. A file-level function now shadows a bare builtin, before or after its declaration. A public `@take` doesn't, so `@size = { return size(x) }` still means the builtin. A class-level function shadows only after its declaration. A bare builtin with the wrong argument count is a compile error.
- **`@x(…)` was broken on JS as well as Rust.** Rust failed in `rustc`, and JS generated invalid code (`typeof @bump$w`). Each backend now routes `@x` as an actor function. `return @x()` and `return #x()` were parse errors and now work.
- **`#name!` now lexes.** The earlier note claimed it; only `@name!` and `name!` did.
- **A bare name reaches a public function on every target,** resolved once in `lowerSelfChains`. JS threw a `ReferenceError` at runtime, and a typed assign failed on Rust and Erlang.

### Decision: chains from a call on this actor are allowed

`bump!(1).add!(2)` and `v Integer = @add!(1).total()` are allowed, because a self-return is this actor, so the next link is a self-call. `lowerSelfChains` makes each `!` link a statement and the next member a self-call.

- **The head must return self on every path,** or it's the usual "returns a value here, bind it first".
- **Members must be public.** A private function isn't a member, so `bump!(1).hidden!()` is an error.
- **A chain must be a statement's whole value.** Lowering moves the calls ahead of the statement, which would change the order in `x = @a!().get() + @b!().get()`, and would run a condition's calls once or unconditionally. Elsewhere it's a compile error.
- **A function declared in a body can't start one.**

### Backend bugs fixed on the way

- **JS:** calling a param with a function type failed for every reference (`#selfSend` was given a closure). That branch is gone, and the general path handles both forms.
- **JS, Erlang:** `return m` on a local cell put the cell object on the wire on JS, and an unbound variable in the output on Erlang. Rust was already right. `captureReturnedCells` now covers every function, not only nested ones.
- **Rust, Erlang:** self-calls in a class with no private functions went to the file's actor. On Rust the same happened for any self-call with arguments. They now use the class's own dispatch.
- **Rust:** calling a function value that returned self panicked in `.one()`.
- **Erlang:** a reference to a function was a `fun`, which `self_send` can't take. As a value it's now the op name, like a lambda's label.

### Known gaps

- **`&f!` on a function declared in a body is a compile error.** It works only on JS: Rust and Erlang have no value for a local function outside the typed-assign inlining path. An unsuffixed local such as `run!(&dbl)` in statement position has the same gap: on Rust it emits an unbound name, which `rustc` rejects. Not checked at runtime on Erlang.
- **Inline functions passed to a typed slot fail at runtime in some cases,** for example `run!((i Integer) { x <- i })` writing state on JS and Rust. Existing behaviour, not addressed here.
- **Inheriting a class with private state is a compile error.** `D = (C |) *{}` where `C` writes its own `acc` reports "Cannot set 'acc'". Existing behaviour on a clean `HEAD`.

## Generated docs

### Classes named with `!`

`@W!` documents as `W! () => *{ … }`, and `parseInterface` keeps the literal name:
`__types['W!']`, with `effect: 'write'`. Every constructor record now has `effect`, and a
supertype in a doc can carry `!`.

The class's identifier is `W`, not `W__w`, and `sourceName` on the actor and the supertype
keeps the `!`. So `x W` and `List of W` resolve to the class and are checked, and errors say
`W`. That also repairs `S! = (W! |)`, which inherited nothing before, since the supertype
wasn't renamed along with the class.

- **`W()` on a class named `W!` is an error,** where it used to compile.
- **`W` and `W!` can't both be declared,** since different effects need different names.
- **`(W |)` on a class named `W!` is an error:** write `(W! |)`.
- **A subclass of a writing constructor must be `!`,** whether the parent is in this file or
  in a doc that says `=>`. This enforces the inheritance rule in the design note. A
  grandparent counts through its child, which must itself be `!`.

### Decision: `x W!` stays an error

Write `x W = W!()`. The `!` says that this construction writes, which is a fact about the
call. The actor it produces has the type `W`.

### Decision: a doc states both outcomes as `(Type) | self`

```
go! (Boolean) => (Integer) | self
```

- **Why `|`:** it's the existing union form, and the design note already calls this a union.
  Overloads stay on separate lines, since they differ by params and this doesn't.
- **`self` goes last,** whichever path comes first in the source. `self | (Integer)` is an
  error with that fix in it, so a doc has one spelling.
- **Function types take it too:** `f () => (Integer) | self`.
- **Parsed shape:** `returnsSelf: true` with a non-null `returns`. `returnsSelf` with
  `returns: null` is plain `=> self`.
- **All paths count:** docs walk the function's own returns, not nested functions'. That also
  fixes `=> ()` for a function that returned only from branches.

### Decision: nothing chains on a mixed return

A caller can't know statically which outcome it gets, so a chain could land on a value.
Locally this was already the compile error "returns a value here, so nothing can be chained
on it — bind it first". The same error now covers a remote whose doc states `(Type) | self`.
A remote doc with only `=> (Type)` still isn't checked, because the value may be an actor.

## Public classes and inheritance

Writing tests for the docs work exposed two older bugs, on every target.

### Public classes are constructed by their bare name

`@Pub = *{…}` beside `Pub()` generated invalid output (`class @Pub`), since codegen stored the
class with its `@` and looked it up without one. The `@` says the class is public, which only
docs need. `useBareClassNames` in `src/subclass.js` strips it in place at the top of `compile()`, for
validation and codegen, in both `index.js` and the browser target. So `p.nope()` on a public
class is now checked, a public class can be a superclass, and declaring `Pub` and `@Pub` together
is an error.

### Subclasses inherit state and run the parent's constructor body

A subclass used to inherit methods but no state, so an inherited method that wrote the parent's
cell failed to compile. `resolveSuperclassChain` now returns `inheritedState` and `inheritedInit`,
and `withInheritedState` merges them where each target already merged ingest state.

The two can't be separated, because a cell's initial value is a statement in the constructor body.

- **Each subclass actor has its own copy.**
- **Ancestors' bodies run first,** nearest last. A subclass's initial value can read the parent's.
- **A redeclared name hides the inherited one.** The nearest class's initial value is the only
  one kept, so an overridden initializer doesn't run at all, including any calls in it.
- **Args:** params are already flattened by name, so a parent's body sees the subclass's args.
- **Excluded:** a wrapped superclass (`*name`) is its own actor with its own state, and an `ingest`
  slot is filled by the subclass's tail. Running the parent's `label Text = ingest` would
  overwrite that value.
- **Writes count:** a parent body that writes makes the parent `!`, which the subclass must carry.
