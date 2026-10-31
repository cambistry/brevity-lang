# `!` means the function writes: mutation, return paths, and service docs — 2026-10-31

Status: **DESIGN, agreed in discussion 2026-10-31; not implemented.** Supersedes
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
- **File constructors:** see open decisions.

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
- State declared non-transactional (see open decisions).

**Contagion:** the effect is transitive, so every caller of a writer must be `!`
or `.`, and many handlers become `@place_order!`. Absence of a suffix stays a
strong guarantee. The non-transactional marker is therefore **required**, not an
optional refinement. Without it, adding a log line or memo cache to `get_value`
renames every function above it.

A silent call is not exempt from contagion. That would be simpler, but it would
allow a "read-only" function to contain `account.debit.(10)...`.

**Not suffixed, still counted as writes:** `set`/`update` handlers, `on` handlers
and subscription bodies have no caller-facing name to mark.

## Compile-time checks

| Situation | Result |
|---|---|
| Function writes, has no `!` or `.` | Error: add `!` |
| `!` function never writes | Error (interface exception above) |
| Tail value in a `!` function | Error: did you mean `return`? |
| Bare tail `self` in a `!` function | Error: delete it, or write `return self` |
| Bare statement discards a read-only call: `a.sorted()` | Error; suggests `sorted!` if it exists |
| `a.sort()` when only `sort!` exists | Unknown member (exists today) |
| `!` returns its receiver's class but isn't the receiver | Warning at the declaration |

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

```
sort (by) -> self            // JS: no bang, writes
uniq! () -> (Array)          // Ruby: the bang is just part of its name
```

- **Return shape** is already in the doc: `-> .`, `-> (Type)`, `-> self`. Like `.`,
  `self` stands alone as the whole output, so it takes no parens:
  `{ mod! (Integer) -> self }`. `(self)` is retired, leaving one spelling. "Silent"
  comes from `-> .`, not the name. The 10-30 rule tying the dot to `-> .` applies to
  Brevity's own docs; a foreign no-reply function is `log (Text) -> .`.
- **Effect** is new, and needs a spelling (see open decisions).
- **Undeclared means may write.** It's the only safe default for transactions. A
  call to an unannotated JS function forces `!` on its Brevity caller until someone
  documents the function as a read.
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

Recommendations are mine; spelling hasn't been discussed.

1. **Non-transactional marker.** State or actors exempt from write inference, for
   logs, metrics and caches, like C++ `mutable`. *Blocks phase 4.*
2. **Effect marker in docs.** Since undeclared means may write, what needs marking
   is the read. Recommendation: a prefix like the existing `set label (Text)`, as
   in `read len () -> (Integer)`. Bare fields (`total Integer`) are already
   read-only. Hand-written manifests like the DOM's need it added to every query.
   *Blocks phase 3.*
3. **Wire-name alias.** A Brevity actor serving a foreign protocol that requires a
   writing op called `push` has to name it `push!`, so the wire names don't match.
   Needs an explicit alias on the declaration. *Blocks phase 3 for that case only.*
4. **File constructors.** A `.bv` file has no declared name to carry `!`.
   Recommendation: put it on the local alias, `"widget.bv": Widget!`, checked
   against the doc.
5. **`emit` and `.subscribe`.** Recommendation: `emit` counts as a write, and
   `.subscribe` doesn't.
6. **`el.field <- x` as an expression on a remote actor.** Recommendation: v1 allows
   the expression form, chains included, on local cells only. Also still to confirm: how the capability code treats a
   returned `*acc`.

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

`<-` is a statement today (`AST.setStatement`), and `parseExpr`
(`src/parser.js:2316`) rejects it. Add the expression form for local cells, with
reference-vs-value errors at the call site.

- Statement sites look ahead for `IDENT SET` and each parse the set themselves;
  they must also accept a chain. `return` needs the same lookahead, since
  `parseReplyFields` consumes the leading name first.
- Tests: `return acc <- acc + i`, `a <- b <- c`, `a <- (b <- c)`, `return a <- 1, 2`
  against `return (a <- 1, 2)`, and `1 + a <- 2` as an error.

### Phase 3: service doc contracts

- Add the effect marker and read it from the doc, never from the name.
- Mark the DOM and document manifests.
- Generate the marker for Brevity services.
- Fix `log! (Text) -> .` in the
  [service doc note](session-2026-10-29-service-doc-notation.md), and the exemption
  for bang entries from 10-30.
- Add the wire alias.

Goes before phase 4 so enforcement doesn't force `!` onto every caller of a function
that could have been documented as a read.

### Phase 4: effect inference and enforcement

- New pass in `src/validate.js`: compute each function's effects to a fixpoint
  across calls, with escape analysis for local cells and fresh actors, and the
  non-transactional exemption.
- Turn on the errors in the checks table, and the remaining tail-value and
  discarded-call errors.
- Migrate the corpus. `<-` alone appears on about 300 lines across 44 test files,
  and contagion will add their callers, so that's a lower bound. Docs and
  `agent-resources/` too.

### Follow-ups

- Chain pipelining, using the self-return guarantee.
- Handing effect data to the transaction work.
- Effects in function slot names (`f!`), which also covers the 10-30 open item on
  params holding silent refs.
