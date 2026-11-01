# `!` means the function writes: mutation, return paths, and service docs — 2026-10-31

Status: **Phases 1-4 IMPLEMENTED, 2026-10-31 to 11-01**
([session note](session-2026-10-31-mutation-suffix.md)), with `<-` as a value still a
compile error. Phase 4 is uncommitted for review. Supersedes
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
  items *List of Integer = []

  @total = -> acc                                // read-only
  @inc! = (i Integer) { acc <- acc + i }         // returns self
  @pop! = {
    v = items.last
    items <- items.rest
    return v
  }
}

C().inc!(5).inc!(2).total
```

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
| `return acc <- x` | Returns a reference to `acc` |
| `if c { acc <- 1 }` | Valid |
| `if c { acc <- 1 } else { 0 }` | Error: the second branch ends in a tail value |

Known gap, accepted: `take! = { log!(); q.pop!() }` returns self and discards the
popped value. A tail call to a writer is a legitimate effect, so it stays legal.
The caller's types catch most of these mistakes.

These rules bind `!` bodies only. In a read-only function a bare tail `self` is an
ordinary tail return: legal, if rarely useful.

### The value of `<-`

`acc <- v` is a set on the cell, so it evaluates to a reference to the cell.
Being a valid final statement is separate from being a return value:

```brevity
@inc! = (i Integer) { acc <- acc + i }            // returns self
@inc! = (i Integer) { return acc <- acc + i }     // returns a reference to acc
```

- `return acc <- x` is exactly equivalent to `acc <- x; return *acc`, with the
  same capability rules. This is an explicit handoff of write capability.
- **Not implemented yet.** `return *acc` doesn't exist: cells can't leave a function,
  and cross-actor scalar cell handoff is explicitly deferred
  (`__tests__/classes/param_capabilities.test.js`). So `<-` as a value parses and
  reports a compile error. Statements and chains work. See open decision 2.
- Readers from C will expect the new number. The compiler reports a reference
  where the caller expects `Integer`, rather than dereferencing it silently. To
  return the number: `acc <- x; return acc`.

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
- **Parens still regroup.** `a <- (b <- c)` writes `c` to `b`, then puts a reference
  to `b` in `a`, which is a type error unless `a` holds references.
- **A comma in a list belongs to the list.** The statement `a <- 1, 2` is a
  multi-argument set (`src/parser.js:1276`), so `return a <- 1, 2` would otherwise
  be ambiguous. It means `return (a <- 1), 2`. A multi-argument set inside a list
  needs parens: `return (a <- 1, 2)`. The statement form is unchanged.

### Self on the wire

A self-return is an empty reply whose `bv-a` is the local-form self address:

```
{ id, re: {}, 'bv-a': '#<>' }
```

- **`#<>` is the canonical self address:** local form, no selector. An actor doesn't
  know what it's called, so it can't name its class or address. By the
  leading-character rule a non-word start is local, so the parent promotes it to
  `#<addr>` like any other local address. `#<self>` would read as a global.
- **`re: {}` is a placeholder.** `re` is what marks a message as a reply, but a
  self-return carries no data.
- **The caller reads `bv-a` as well as `re`.** After translation `bv-a` is the actor's
  address in the caller's frame, and that address is the call's value.
- **Parents translate in-process children too.** An untranslated `#<>` reaching a
  caller would mean the caller itself, so the child-reply paths must swap in the
  caller's handle for the child.
- **A host of many sub-actors names the sub-actor.** The DOM runtime replies with the
  element's address rather than `#<>`, which would mean the HTML node.
- **`self` is a return-position value only in v1:** `return self` and a tail `self`.
  `x = self` and `f(self)` are errors for now, and can be widened later.

## Functions

Brevity has no separate lambda concept. Lambda notation is a way to write a
function, and a function is a closure that captures `self`. So these rules apply
to all of them:

```brevity
bump! = (i) -> acc <- acc + i      // returns the captured self
```

Inline anonymous functions have no name to carry a suffix:

- A write in one makes it a mutating function, so it has no tail return. It falls
  through to the captured `self`, unless the slot it fills is silent.
- v1: its writes are attributed to the function that defines it, which must then
  be `!`. This is conservative: a function that only creates and returns a writing
  closure also gets a bang.
- Later: the slot can declare the contract through its name (a parameter `f!`).

## Constructors

No special rule. A constructor is a function that returns a new actor, and inside
it `self` is that actor. A constructor that writes to something else therefore
writes and returns self, so it takes `!`:

```brevity
w = Widget(1)
x = RegisteredWidget!(2)
y = RegisteredWidget!(2).add!(z)     // chains on the new actor
```

- **The actor's own setup doesn't count:** initializing its refs, calling its own
  `!` functions, constructing its children.
- **A class body's tail is not a return:** it feeds `ingest`, and is unaffected.
- **Inheritance:** a superclass constructor's effect carries to the subclass.
- **Overloads:** the suffix is part of the name, so all overloads share one effect
  class. Different effects need different names. The same applies to functions.
- **File constructors:** see settled decisions.

## What counts as a write

The compiler infers this. There is no effect analysis in `src/validate.js` today.

**Writes:**
- `<-`, `<|` and `>>` on state that outlives the call.
- `*x.method!()` on built-ins.
- Calling any `!` function, or any silent function.
- Calling a remote function whose doc doesn't declare it read-only.

**Not writes:**
- Local cells that don't escape the function.
- Writes to an actor created in this function that hasn't escaped yet. Without
  this exemption every factory would need a suffix:

  ```brevity
  make_widget = {
    w = *Widget()
    w.add!(x).add!(y)
    return w
  }
  ```

  Passing or storing `w` before the write counts as escaping. Creating an actor
  isn't a write either: if a transaction aborts, the runtime discards it.
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
*{
  untracked hits *Integer = 0
  untracked @log *Text = ""
  untracked @write. = (m Text) { log <- log + m }
  untracked audit = Logger()
}
```
```
{
  untracked log *Text
  untracked write. (Text) => .
}
```

- **Callers don't count it.** The arrow still says what the function does.
- **Bodies are checked.** An `untracked` Brevity function may only write `untracked`
  state or call `untracked` functions, so `untracked @debit.` can't hide a real write.
- **Importers can state it for foreign services:**
  `"logger.js": Log -> *{ untracked write. (Text) => . }`.
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
| Bare statement discards a read-only call: `a.sorted()` | Error; suggests `sorted!` if it exists |
| `a.sort()` when only `sort!` exists | Unknown member (exists today) |
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
  `~>` in its own generated doc. A claim can't become a guarantee on the way up.
- **`->` in a hand-written doc is its author's word.** The compiler can't check it. Use
  `~>` unless you own the implementation; the DOM manifest's queries stay `->`.
- **`->` in source is unchanged.** Body arrows aren't effect notation; this applies in
  type positions and docs.
- **A dependency with no doc at all counts as may write.** Every documented entry states
  its effect, so this is the only undeclared case left.
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
| Right-associative `a <- b <- c` | `b <- c` evaluates to a reference to `b`, not its value, so `a` would receive a reference rather than `c` |
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
2. **What `<-` yields as a value.** The design says a reference to the cell, which
   needs a wire form for a returned cell, including one that isn't `@`-published. No
   such mechanism exists, so a value use is a compile error for now. Until this is
   settled, the expression form is also limited to local cells, not `el.field`.

## Settled decisions

- **`emit` counts as a write, `.subscribe` doesn't.**
- **File constructors:** `"widget.bv": Widget! (a: Integer) => *{ … }`. `=>` is the fact
  and `!` on the local alias shows it at the call site. They must agree. One that
  doesn't write is `Widget (a: Integer) -> *{ … }`.

## Implementation plan

Scope test runs to changed files, on all targets. No target skips.

### Phase 1: declaring and returning from `!` functions

No open decisions block this.

- **Lexer/parser:** accept `!` on class, private and local function names and on
  function-typed fields, and reject it on value fields. Today the lexer has no name
  suffix for `!`, the parser only handles it on members
  (`src/parser.js:2168`) and interfaces, and no test declares one. Share the suffix
  handling with `silentSuffixAt` where possible.
- **Body rules:** tail return off, fall through to self, rules 3-6. The promotion
  to `ImplicitReturn` is at `src/codegen/javascript/classes.js:80-89`, with
  counterparts in rust and erlang.
- **Tail-value error, partial:** catch what's syntactically pure (names, literals,
  operators, structures). Tail calls wait for phase 4, which knows their effects.
- **Backends:** sanitize `!` in derived identifiers the way `.` is handled (JS
  `$`, Rust/Erlang `fire__s`). Return self on all three.
- **Built-ins:** `assertBangValidRef` (`src/parser.js:12`) stays. Those methods
  already require a same-type return.
- **Docs:** generated service docs emit `sort! (by) -> self`.
- **`-> self`:** `parseFunctionType` (`src/parser.js:486`) rejects both `-> self` and
  `-> (self)` today, so it needs to accept the former. Inline interfaces are kept as
  raw text and already get through the parser with either. Move the 67
  `-> (self)` lines in `src/codegen/browser/runtime.js` to `-> self`.
- **Tests:** new `__tests__/functions/bang.test.js`. Revisit
  `__tests__/types/bang_name_enforcement.test.js` where it assumes declarations
  can't carry a bang.

### Phase 2: `<-` as an expression

Done, except for yielding a value (open decision 2). Chains spread into one statement
per link, and a final write in arrow form is a statement in a `!` function.

### Phase 3: service doc contracts

- Add `=>` and `~>` to docs and function types, and read effects from the arrow, never
  from the name. Report the error forms in the table above.
- Mark the DOM and document manifests.
- Generate the arrows for Brevity services.
- Parse `untracked` on doc entries, for phase 4.
- Fix `log! (Text) -> .` in the
  [service doc note](session-2026-10-29-service-doc-notation.md), and the exemption
  for bang entries from 10-30.

Goes before phase 4 so enforcement doesn't force `!` onto every caller of a function
that could have been documented as a read.

### Phase 4: effect inference and enforcement

Done, in `src/effects.js`. The check is local rather than a fixpoint: a callee's effect
comes from its name or its doc's arrow, and the callee's own body answers for that name.

### Follow-ups

- Chain pipelining, using the self-return guarantee.
- Handing effect data to the transaction work.
