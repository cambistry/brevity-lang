# `!` means the function writes: mutation, return paths, and service docs — 2026-10-31

Status: **IMPLEMENTED and committed, on every target.** Phases 1-4 landed 2026-10-31 to
11-01 ([session note](session-2026-10-31-mutation-suffix.md)). The open effect rules were
settled and landed 2026-11-03 (`dd9b31e`, `bcdc63a`;
[session note](session-2026-11-03-effect-rules.md)). Supersedes
[bang-returns-self](bang-returns-self-2026-10-27.md). Builds on
[bang-name-suffix-enforcement](bang-name-suffix-enforcement-2026-10-27.md) (name
match at the call site, kept) and
[session-2026-10-30-silent-dot-suffix](session-2026-10-30-silent-dot-suffix.md)
(`.` suffix, kept).

## Summary

A function's name says whether it writes. Its return paths say what it yields.

| Declaration | Meaning | Yields |
|---|---|---|
| `total` | Read-only | Its return value (implicit tail return applies) |
| `sort!` | Writes | `self`, by falling off the end |
| `pop!` with `return v` | Writes | `v` |
| `fire.` | No reply; may write or send | Nothing |

```brevity
C = *{
  acc *Integer = 0

  @total = -> acc                                // read-only
  @inc! = (i Integer) { acc <- acc + i }         // returns self
  @take! = {                                     // returns v
    v Integer = acc
    acc <- 0
    return v
  }
}

@go = { return C().inc!(5).inc!(2).total() }
```

`@go` needs no `!`: its writes all land on an actor it just made
(see "What counts as a write").

Why the sigil is on every write: `top = a.sort().first` must never silently
reorder `a`. Whether a call writes matters far more to a reader than which
receiver the chain continues on, and the compiler needs the same fact to manage
transactions.

The convention binds **functions Brevity compiles**. Functions in other languages
are described by their service doc, and their names are never interpreted.

## Rules for a `!` function body

1. **No implicit tail return.** Implicit return is valid only on non-mutating
   functions.
2. **Falling off the end returns `self`.**
3. **`return v` returns `v`.** What comes back is a property of each return path.
   `return self` is always legal, including at the tail and when every path
   returns self. It's never flagged as redundant.
4. **A tail value is a compile error.** A final non-mutative expression is
   discarded work, so the message suggests the fix: "did you mean `return v`?"
5. **A bare tail `self` is the same error**, since it's a non-mutative final
   expression. Delete it, or write `return self`.
6. **Mixed paths are an error.** If one path has `return v` and another falls off
   the end, the author writes `return self` on the second to make the union
   deliberate.
7. **A `!` function must write on at least one path.** Exception: an
   implementation of a declared `!` interface member may be purer than the
   declaration.

| Tail statement | Result |
|---|---|
| `acc <- acc + i` | Valid; returns self |
| `other.write!()` | Valid; returns self, that call's result is discarded |
| `v`, `x + 1`, `a.total()` | Error |
| `self` | Error |
| `return self` | Returns self |
| `return v` | Returns `v` |
| `return acc <- x` | Returns `acc`'s new value |
| `if c { acc <- 1 }` | Valid |
| `if c { acc <- 1 } else { 0 }` | Error: the second branch ends in a tail value |

Known gap, accepted: `take! = { log!(); q.pop!() }` returns self and discards the
popped value. A tail call to a writer is a legitimate effect, so it stays legal.
The caller's types catch most of these mistakes.

These rules bind `!` bodies only. In a read-only function a bare tail `self` is an
ordinary tail return: legal, if rarely useful.

### The value of `<-`

Revised 2026-11-03 (was: a reference to the cell). `acc <- v` evaluates to the
cell `acc`, which now holds the new value, so used as a value it gives that value.
Being a valid final statement is separate from being a return value:

```brevity
acc *Integer = 0
@inc! = (i Integer) { acc <- acc + i }            // returns self
@add! = (i Integer) { return acc <- acc + i }     // returns acc's new value
```

- `return acc <- x` is exactly `acc <- x; return acc`. `<|` and `>>` likewise give
  the cell's new contents.
- No cell leaves the function, so no capability is handed over.
- Cells only: `el.field <- v` has no value.
- A write on the right of `??` is an error, since that part may not run.

**Grammar.** `<-` is usable wherever an expression is, with no parens required:

- **The left side is a write target.** `1 + a <- 2` is an error, not
  `1 + (a <- 2)`.
- **The right side takes a whole expression**, as the statement form does today, and
  stops at the next `<-`. `return acc <- acc + i` is `return (acc <- (acc + i))`.
- **Chains are left-associative and stay on the target.** `a <- b <- c` is
  `(a <- b) <- c`. The first set evaluates to `a`, so `c` goes to `a` as well. `a`
  ends up holding `c`, `b` is only read, and the whole expression evaluates to `a`.
  This mirrors `1 >> 2 >> ns`, which is right-associative because its target is on
  the right. `<|` chains the same way.
- **Readers of C will expect `a = b = c`**, writing both. Here `b` isn't written,
  and if the types match nothing reports it. Accepted, since the chain follows
  directly from `<-` evaluating to its target.
- **Parens still regroup.** `a <- (b <- c)` writes `c` to `b`, then writes `b`'s new
  value, `c`, to `a`. This is the C-style double write.
- **A comma in a list belongs to the list.** The statement `a <- 1, 2` is a
  multi-argument set (`src/parser.js:1276`), so `return a <- 1, 2` would otherwise
  be ambiguous. It means `return (a <- 1), 2`. A multi-argument set inside a list
  needs parens: `return (a <- 1, 2)`. The statement form is unchanged.

### Self on the wire

Revised 2026-11-03 (`notes/session-2026-11-03-self-return-like-new.md`). A
self-return replies like `#new`: the actor's address in `re`, its class's address
in `ty`.

```
child:   { id, re: '#<>' }
parent:  { id, re: '#<@Counter/1>', 'ty': '@Counter' }
```

- **The child says "me" with a bare `#<>` and no `ty`.** An empty selector means
  the actor that's replying. An actor can't name its own address or its class, so
  any tag would be a stand-in. `#<Self>` would read as a global address called
  `Self`.
- **A reply whose whole value is one actor is a bare address in `re`.** Same group
  as the reply to `#new` and a handler returning bare `Self`.
- **`self` can be one slot of several** (2026-11-03): `return (self, 1)` is
  `{ re: ['#<>', 1], ty: ['@', 'Integer'] }`, and `return (me: self, n: 1)` is the
  named form. A bare `@` in `ty` is "my class", the class-level `#<>`; `ty` keeps the
  value's shape, so the slot needs it. When the whole value is `#<>`, the `@` is
  implied and `ty` is left out. The parent replaces both, slot by slot.
- **The parent that made the child names it.** It sees `re: '#<>'`, promotes it to
  the child's address, and adds `ty` with the child's class address. The marker
  in the reply is the trigger, not the child's profile.
- **Higher parents translate `re` and `ty` alike.** Only the first parent adds
  `ty`. `ty` has no `#<…>` (2026-11-03, `session-2026-11-03-ty-without-brackets.md`):
  a tag that starts with a delimiter is local and gets the parent's address.
- **Parents translate in-process children too.** An untranslated `#<>` reaching a
  caller would mean the caller itself, so the child-reply paths swap in the
  caller's handle for the child.
- **A host of many sub-actors names the sub-actor.** The DOM runtime replies with
  `{ re: '#<HTML @div/1>', 'ty': 'HTML @div' }`, as it does to `#new`.
- **`self` is a return-position value only in v1:** `return self`, a tail `self`, and
  a slot of a return list. `x = self` and `f(self)` are errors for now, and can be
  widened later.

## Functions

Brevity has no separate lambda concept. Lambda notation is a way to write a
function, and a function is a closure that captures `self`. So these rules apply
to all of them:

```brevity
acc *Integer = 0
bump! = (i Integer) -> acc <- acc + i      // a final write is a statement: returns self
```

Inline anonymous functions have no name to carry a suffix:

- **The slot's arrow decides** (settled 2026-11-03), by the rules for a named
  function. In a `=>` slot it has no tail return and falls through to the captured
  `self`; `=> (T)` needs `return` with a value, and in `=> .` it yields nothing. In a
  `->` slot it must be read-only, with an implicit tail return.
- **Its writes are attributed to the function that defines it,** which must then be
  `!`. This is conservative: a function that only creates and returns a writing
  closure also gets a bang.
- **A param's type states the contract,** as `f (Integer) => ()`, so no slot needs a
  `!` in its name.

## Constructors

No special rule. A constructor is a function that returns a new actor, and inside
it `self` is that actor. A constructor that writes to something else therefore
writes and returns self, so it takes `!`:

```brevity
*
  "Svc": Svc {
    register. (Integer) => .
  }
*

Widget = (n Integer) *{
  @get = -> n
}

RegisteredWidget! = (n Integer) *{
  Svc.register.(n)...                       // writes past the new actor
  @add! = (i Integer) { Svc.register.(i)... }
}

@go! = {
  w = Widget(1)
  x = RegisteredWidget!(2)
  y = RegisteredWidget!(2).add!(3)          // chains on the new actor
  return 1
}
```

- **The actor's own setup doesn't count:** initializing its refs, calling its own
  `!` functions, constructing its children. Narrowed 2026-11-03: its own functions
  count when their writes reach past the actor (see "Settled 2026-11-03").
- **A class body's tail is not a return:** it feeds `ingest`, and is unaffected.
- **Inheritance:** a superclass constructor's effect carries to the subclass.
- **Overloads:** the suffix is part of the name, so all overloads share one effect
  class. Different effects need different names. The same applies to functions.
- **File constructors:** see settled decisions.

## What counts as a write

The compiler infers this, in `src/effects.js`, at the end of validation.

**Writes:**
- `<-`, `<|` and `>>` on state that outlives the call.
- `*x.method!()` on built-ins.
- Calling any `!` function, or any silent function.
- Calling a dependency's function that its doc marks `=>`. A `~>` counts as a read
  (see "`~>` spreads" below).

**Not writes:**
- An `emit`, and `.subscribe`: what a subscriber does is its own
  ([emit-not-a-write](emit-not-a-write-2026-11-03.md)).
- Local cells that don't escape the function.
- Writes to an actor created in this function that hasn't escaped yet, if the
  function called writes nothing past that actor. Without this exemption every
  factory would need a suffix:

  ```brevity
  Widget = *{
    n *Integer = 0
    @add! = (i Integer) { n <- n + i }
  }

  make_widget = {
    w = Widget()
    w.add!(1).add!(2)
    return w
  }
  ```

  Passing or storing `w` before the write counts as escaping. Creating an actor
  isn't a write either: if a transaction aborts, the runtime discards it. A fresh
  actor of a dependency's class (`Svc.Thing()`, `Svc()`) always counts, since a doc
  can't say where its writes land.
- `untracked` cells, functions and nested actors (below).

**Contagion:** the effect is transitive, so every caller of a writer must be `!`
or `.`, and many handlers become `@place_order!`. Absence of a suffix stays a
strong guarantee. `untracked` is therefore **required**, not an optional refinement.
Without it, adding a log line or memo cache to `get_value` renames every function
above it.

A silent call is not exempt from contagion. That would be simpler, but it would
allow a "read-only" function to contain `account.debit.(10)...`.

**Not suffixed, still counted as writes:** `set`/`update` handlers, `on` handlers,
subscription bodies and inline element handlers (`onclick={ … }`, synthesized as `@0`)
have no caller-facing name to mark.

### `untracked`

Writes that don't count: logs, metrics, caches. It applies to cells, functions and
nested actors, and it crosses actor borders through the doc.

```brevity
Logger = *{
  n *Integer = 0
  @note! = (m Text) { n <- n + 1 }
}

untracked hits *Integer = 0
untracked @log *Text = ""
untracked @write. = (m Text) { @log <- @log + m }
untracked audit = Logger()

@get = {
  hits <- hits + 1
  @write.("x")...
  audit.note!("y")
  return 1
}
```

Its generated doc:

```
{
  untracked log *Text
  untracked write. (Text) => .
  get () -> (Integer)
}
```

- **Callers don't count it.** The arrow still says what the function does.
- **Bodies are checked.** An `untracked` Brevity function may only write `untracked`
  state or call `untracked` functions, so `untracked @debit.` can't hide a real write.
- **Importers can state it for foreign services**, in the inline doc:

  ```brevity
  *
    "logger.js": Log {
      untracked write. (Text) => .
    }
  *
  ```
- **Transactions don't roll it back.**
- **It's a reserved word for locals only.** `@untracked`, `#untracked`, a member
  `x.untracked` and a key `untracked:` are all fine, and a doc entry `untracked (…)` is
  a function with that name. A named param takes the rename form,
  `(untracked: u Integer)`.

## Compile-time checks

| Situation | Result |
|---|---|
| Function writes, has no `!` or `.` | Error: add `!` |
| `!` function never writes | Error (interface exception above) |
| Tail value in a `!` function | Error: did you mean `return`? |
| Bare tail `self` in a `!` function | Error: delete it, or write `return self` |
| Value on one path, falling off the end on another | Error: write `return self` |
| Bare statement discards a read-only call: `a.sorted()` | Error |
| `a.sort()` when only `sort!` exists | Unknown member |
| Writing function passed to a `->` slot | Error: the param type would need `=>` |
| Anonymous function in a `=>` slot yields what the slot doesn't say | Error |
| Type field's name doesn't match its arrow | Error: `=> self` and `=> (T)` need `run!`, `=> .` needs `run.` |
| `untracked` function writes tracked state | Error |
| Class writes while constructing, has no `!` | Error, also for a subclass of a writing class |
| Chain on a `!` call that returns a value, or on a doc's `(T) \| self` | Error: bind it first |
| `!` returns its receiver's class but isn't the receiver | Warning at the declaration (not built: the compiler has no warning channel) |

The last row covers the one case where a misread chain still type-checks:

```brevity
node.add_child!(a).add_child!(b)    // nests under a if add_child! returns the child
```

The author either returns self or renames, like `new_child!`.

## Polyglot: the service doc is the source of truth

CAM is polyglot. A JS function can have side effects without a bang, and we don't
rely on adapting interfaces to normalize remote conventions. So:

| Layer | Source of truth | What's enforced |
|---|---|---|
| Brevity function | Compiler's analysis of the body | Suffix must match the effect and return |
| Service doc | The doc's own fields | Name is a literal string; effect and return are stated separately |
| Call site | The doc | Name must match the doc exactly |

**The compiler never infers a contract from a name in a doc.** Other languages
have their own conventions: Ruby's `uniq!` returns nil when nothing changed, so
reading its bang as "returns self" would be wrong.

The arrow states the effect, and the name is never interpreted:

| Entry | Meaning |
|---|---|
| `() -> ()` | Read-only |
| `() -> self` | Identity |
| `() ~> ()` | Purported read-only: treated as a read, but not guaranteed |
| `() => ()` | Writes, returns a value |
| `() => self` | Writes, returns self |
| `() => (Integer) \| self` | Writes, returns a value or self depending on the path; can't be chained on |
| `() => .` | Writes, silent |
| `() -> .`, `() ~> .`, `() ~> self` | Errors: nothing to read. A fluent method whose effect is in doubt is `=> self` |

```
sort (by) => self            // JS: no bang, writes
uniq! () => (Array)          // Ruby: the bang is just part of its name
log (Text) => .              // foreign silent function
```

- **Function types use the same arrows.** A param typed `f: (Integer) -> (Integer)`
  requires a read-only callback, which replaces the `f!` slot-name idea.
- **`~>` spreads.** It doesn't force `!`, but a Brevity function that reads a `~>` gets
  `~>` in its own generated doc, and so does every function in the file that reaches it
  through calls, to a fixed point (`purportedFunctions` in `src/effects.js`). A claim
  can't become a guarantee on the way up. A `!` or `.` function keeps `=>`, and a `~>`
  call is reason enough for a `!`.
- **`=>` and `~>` are for signatures only:** docs, function types and type fields. A
  body's arrow is `->`, so `(i Integer) => i` is an error.
- **`->` in a hand-written doc is its author's word.** The compiler can't check it. Use
  `~>` unless you own the implementation; the DOM manifest's queries stay `->`.
- **`->` in source is unchanged.** Body arrows aren't effect notation; this applies in
  type positions and docs.
- **Every dependency has a doc,** inline in the header or supplied through
  `options.remotes`; without one, compiling fails. Every entry states its effect, so no
  call's effect is undeclared.
- **The compiler generates docs for Brevity services** from what it already knows,
  so nothing is written twice.
- **Importers can state a foreign contract** without an adapter, since an inline
  interface already overrides the remote doc
  ([session-2026-10-29](session-2026-10-29-params-document-header-notation.md)).
- **Wire ops carry the literal name**, as `.` already does: `@sort!`. `sort` and
  `sort!` must stay distinct, so the suffix can't be stripped.

Costs, stated plainly:

- **The call-site guarantee only holds for Brevity-compiled functions.**
  `js.sort().first` can reorder an array and look like a read. The compiler can
  still force the enclosing Brevity function to be `!`, so the effect can't be
  hidden from that function's callers.
- **Docs can be wrong.** The compiler has to trust them, and a function falsely
  documented as read-only breaks transaction handling. That risk belongs to the
  doc's author.

## Payoff beyond naming

A self-return carries no data the caller lacks, so
`a.m1!().m2!().get_value` can be pipelined and awaited only at the end, stopping
at the first failure. That's one round trip instead of three, and it gives
transactions a natural grouping. Fire-and-forget stays a caller's choice with
`...`, unchanged from 10-30.

## Costs accepted

- **Noise:** `my_actor.mutate!(p).mutate_again!(p).get_value`. It pays for itself
  by marking every write.
- **Receiver ambiguity at the call site:** `a.sort!().first` and `q.pop!().name`
  look alike. Type errors catch nearly every misread, and the compiler always knows
  which is which.
- **No declaration-level contract for value returns:** nothing at the top of `pop!`
  says it returns a value. Public interfaces show it, and the body can only change
  the contract by writing `return`.
- **Aliasing:** `b = a.sort!()` makes `b` the same actor as `a`. The bang makes this
  visible.

## Alternatives rejected

| Option | Why not |
|---|---|
| No sigil on self-returning mutators, `!` only for non-self (the first proposal) | `a.sort()` can mutate invisibly, and `top = a.sort().first` triggers no warning |
| `actor.modify~(p)` for self-return | Only says the receiver continues, not that it wrote |
| `~` for write-and-return-value | Adds a third write mark; awkward in practice (`Widget~(parent)`) |
| `pop!!` | Doubling reads as more danger: `q.pop!!()` looks worse than `db.drop_all!()` |
| `pop:()` | Lexes the same as named arg `pop: ()`; a field would be `pop::`, colliding with the type operator |
| Declared `pop! returns Item` | Costs return-type inference. With tail return off, `return` alone marks the exception |
| `<-` has no value | Was to stop a tail `<-` leaking the cell; rule 1 already closes that |
| `<-` expression in parens only | Unneeded: its right side already takes a whole expression, so `return acc <- x` has one reading |
| Right-associative `a <- b <- c` | Writes two cells with no parens to show it. Left-associative keeps one target, and `a <- (b <- c)` gives the double write when it's wanted |
| Byproduct channels (the 10-27 note) | Unneeded now that `!` may return a value |

## Superseded in [bang-returns-self](bang-returns-self-2026-10-27.md)

- **`!` means returns self:** now `!` means writes, and self is the default return.
- **"A bang function takes no return declaration":** `return v` is allowed.
- **Collapsing silent into bang:** 10-30 kept `.` as its own category.
- **Clobbering `toggle!`/`replace!` to return self:** unneeded; those five manifest
  lines (`src/codegen/browser/runtime.js:472-476`) are valid as they stand.
- **Byproduct tiers and the `pop!` question:** `pop!` simply returns its value.
- **Kept:** chained-query offload, now the pipelining follow-up.

## Open decisions

1. **Wire-name alias.** A Brevity actor serving a foreign protocol that requires a
   writing op called `push` has to name it `push!`, so the wire names don't match.
   Only affects serving, since a call to a foreign name keeps it literally. Deferred;
   nothing needs it yet.
2. ~~What `<-` yields as a value.~~ Settled 2026-11-03: the cell's new value. See below.

## Settled 2026-11-03: the open effect rules

**Implemented 2026-11-03,** with what it took, in the
[session note](session-2026-11-03-effect-rules.md).

- **Fresh actors only exempt writes to themselves.** A call on an actor created in this
  function, before it escapes, is exempt only if the callee writes nothing but its own
  actor's state. The same applies to a constructor's calls to its own functions, since
  inside a constructor `self` is a fresh actor. This needs a second fact per function in
  this file: whether its writes reach past its own actor. A dependency's doc can't state
  that, so calls on a fresh dependency always count. An emit doesn't reach past the actor
  ([emit-not-a-write](emit-not-a-write-2026-11-03.md)).
- **A constructor follows the same rules as a function.** A class named `!` that never
  writes is an error. Overriding a `!` member of a foreign parent may be purer than the
  parent, as with a parent in this file. No `return` is required in a constructor block:
  its tail feeds `ingest`.
- **Tail-return rules don't depend on whether a function is named.** An anonymous
  function in a `=>` slot follows the rules for a `!` function: no tail return, it falls
  through to the captured `self`, and a value needs `return`. In a `=> .` slot it yields
  nothing. In a `->` slot it's read-only, with an implicit tail return.
- **A type field's name must match its arrow.** `=>` with a value or self needs `run!`,
  `=> .` needs `run.`, `->` needs a bare name, and a value field can't take `!`. A
  call on a `run!` field is a write by its name.
- **`<-` as a value yields the cell's new value.** `return a <- x` is `a <- x; return a`.
  Cells only, not `el.field`.
- **`untracked @log` from inside its own actor** works, since
  [session-2026-11-01-own-published-cells](session-2026-11-01-own-published-cells.md).

## Settled decisions

- ~~**`emit` counts as a write, `.subscribe` doesn't.**~~ Reversed 2026-11-03: neither is a
  write ([emit-not-a-write](emit-not-a-write-2026-11-03.md)).
- **Mixed return paths in docs:** `=> (Type) | self`, and nothing chains on one. See "Generated
  docs" in [the session note](session-2026-10-31-mutation-suffix.md). Value paths that differ among
  themselves: `(Integer | Text)` or `(a: Integer) | (Integer)`, in
  [session-2026-11-01](session-2026-11-01-return-shapes.md).
- **A class named with `!`:** its doc entry is `W! () => *{ … }`, and its actors are annotated
  `x W`; `x W!` is an error.
- **File constructors:** `"widget.bv": Widget! (a: Integer) => *{ … }`. `=>` is the fact
  and `!` on the local alias shows it at the call site. They must agree. One that
  doesn't write is `Widget (a: Integer) -> *{ … }`.

## Implementation

All four phases are done, on every target:

1. **Declaring and returning from `!` functions:** names, body rules, self-return on the
   wire, `-> self` in signatures. [Session note](session-2026-10-31-mutation-suffix.md).
2. **`<-` as an expression:** chains spread into one statement per link, a final write in
   arrow form is a statement, and a value use yields the cell's new value
   (`settleWrites`, 2026-11-03).
3. **Effect arrows in docs and function types:** `=>` and `~>`, the DOM and document
   manifests, generated arrows, `untracked` on doc entries.
4. **Effect inference and enforcement,** in `src/effects.js`. Two facts are computed to a
   fixed point across the file before any check runs: which functions' writes reach past
   their own actor, and which rest on a `~>`. A callee's effect then comes from its name,
   or its doc's arrow if it's foreign. Writer-body rules for named and anonymous
   functions are shared in `src/writer_body.js`.

### Follow-ups

- Chain pipelining, using the self-return guarantee.
- Handing effect data to the transaction work.
- A warning channel, for `add_child!` returning a child and for a `!` resting only on a
  `~>`.
- The wire-name alias (open decision 1).
- A class's generated doc drops `untracked`: `@Stats = *{ untracked @log *Text = "" }`
  documents `log () -> (Text)`, where the same cell at file level documents
  `untracked log *Text`.
