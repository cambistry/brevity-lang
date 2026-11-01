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
- **Chain from a call on this actor:** `bump!(1).add!(2)` is a compile error, since `@x(…)`
  self-calls don't compile on Rust. Write separate statements.
- **Classes named with `!`:** `W!` constructs and chains, and is renamed `W__w` in the AST,
  so generated docs show that name, and a type annotation `x W!` is an error. File
  constructors are covered in the design note.
- **Generated docs for mixed paths:** they show only the tail return, as they did for
  value returns before.

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
