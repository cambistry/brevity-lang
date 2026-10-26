# `return` keyword vs `->`, and the arrow/becomes unification (2026-10-26)

> **Qualified by `lineal-termination-implicit-return-2026-10-26.md`.** The
> "retire `->` as return" direction below holds — `->` can leave the return role
> in both braced and lineal form — but the *mechanism* differs: braced bodies
> already do implicit return; lineal bodies require promoting the blank line to a
> mandatory member separator and spelling named/multi returns as paren objects
> `(…)`. It is the blank-as-separator that becomes load-bearing, not `->`. The
> glyph persists only as the lambda one-liner arrow and the constructor-tail
> becomes; `return` as a keyword earns no place. See that note for the mechanics.

Design discussion, confirmed in conversation. No implementation. Touches the
same surface as `implicit-return-refinements-2026-04-14.md`,
`self-becomes-2026-04-14.md`, `void-return-2026-05-07.md`, and
`tail-return-wire-2026-04-15.md`.

## The problem: `->` is four things

`->` currently carries four distinct jobs:

1. **In-body return** — `{ … -> 42 }`, `() { -> () }`
2. **Zero-arg lambda / thunk** — `click = -> counter.increment`, `@get = -> x`
3. **Lambda params→body** — `(a, b) -> expr`, `|params| -> Output`
4. **Function-type arrow in signatures / file-becomes** — `open: () -> (Text)`,
   `<"para.bv": (Para) … -> DOM.Element>`

The real wart is the seam between (1) and (2): `-> expr` means *return expr*
inside a braced body but *a zero-arg function yielding expr* at a binding site.
Same glyph, different meaning, disambiguated only by context.

## Decision: `return` is the in-body yield word; `->` becomes the pure arrow

- Introduce `return` as the **optional** explicit yield inside any body.
- `->` becomes **purely** params→body — empty params included. It never means
  "return" again.
- Implicit last-expression (tail) return stays.

This removes the (1)/(2) overload at the source: there is no longer a bare
`-> expr` that reads two ways, because every `->` now has the `params -> body`
shape (params possibly empty). All of these are legal and mean the same:

```
fn = x -> x * 2
fn = x -> return x * 2
fn = x -> { return x * 2 }
fn = { return "value" }
@get = -> x            // zero-param arrow, body x — no longer ambiguous
```

`return` is never the bare RHS of `=` (that was the thing that read broken:
`@get = return x`). It lives after the arrow or inside braces, where it reads
fine. The braceless getter `@get = -> x` survives and stays terse.

`return` is optional and harmless where implicit return already covers the tail.
Downside of fully-optional syntax: house-style drift (examples differ for no
reason). Defer to a formatter/lint opinion later; not a design blocker.

## Unification: return / implicit tail / "return as" are one spelling

Earlier thinking (`self-becomes`) leaned toward a separate `returns as` anchor
for the constructor-block tail, to keep "self becomes" distinct from value
return. **Dropped.** The becomes-ness was never in the return word — it's in `*`.

Invariant that makes this clean:

> `return` (and the implicit tail) always means exactly "**the body yields this
> expression**" — one meaning. Whether yielding is *value handback* or
> *actor-that-projects/becomes* is decided by `*` (the actorize sigil), not by
> the return word.

So:

```
fn =  (name Text) -> <div>{ name }</div>   // value: a function returning a DOM value
C  = *(name Text) -> <div>{ name }</div>   // actor: a template that becomes that element
```

`*` is already the universal actorize sigil; letting it be the thing that turns
"yield a `<div>`" into "an actor that *becomes* a `<div>`" is consistent with how
`*` behaves everywhere. The terse **template form `*(params) -> template` falls
out for free** — it is just `*` + the one universal arrow, not a special case.

## Cost: the word imports an expectation the language refuses

`->` promised nothing about control flow. The word `return` promises early-exit
guard clauses (`if bad { return err }`), non-local return, and divergent branch
types. Brevity offers none of these — the rules remain one-return-per-block,
branch-type-consistent, no non-local return (per `implicit-return-refinements`).

So the trade is "learn a glyph" → "unlearn an expectation," and it lands in
diagnostics: the compiler must actively say *"`return` here can't bail early; it
names the block's single tail value."* Livable, and the readability is worth it,
but it is the one place `-> → return` actively loses something. Go in eyes-open.

## Redundant-`*` lint

Observation: for a **static** template, the `*` and non-`*` forms coincide.

```
*(name Text) -> <div>{ name }</div>
 (name Text) -> <div>{ name }</div>
```

Both instantiate and return a ref to a static `<div>`. A `<div>` is already an
actor (a live DOM node with identity); the `*` wrapper declares no cells and no
handlers, so it has zero surface of its own — a "become X" that adds nothing
collapses to X.

**The operative condition is NOT "`name` is immutable."** It is "the tail yields
an already-actor type AND the body hosts nothing of its own." Proof by scalar
counterexample:

```
 (name Text) -> name    // value function → a Text value (pass-by-value)
*(name Text) -> name    // class → an actor that projects as Text (identity, by-ref)
```

`name` is equally immutable in both, yet these differ — `*` actorizes the value
(`*Integer(0)` story), giving identity the bare value lacks. If the lint keyed on
immutability it would wrongly flag this.

Lint rule: `*` on a class whose body has **no cells, no handlers, and whose tail
yields an already-actor type** → the `*` is inert. Frame the finding as
intent-surfacing, not "delete this," because writing `*` usually signals the
author is *about to* add reactive state:

> nothing here to actorize — add a cell (e.g. `@count`) to make it live, or drop
> the `*` and let it be a plain function.

That catches both genuine redundancy and the half-written-component case in one
message. Warning, not a parse error — both forms compile and work.

## What this exposes: a pay-as-you-go seam

The value→actor boundary is pay-as-you-go. A static template sits exactly on the
seam where the two forms are indistinguishable. The minimal diff that forces them
apart is interpolating a cell instead of a param:

```
*(…) -> <div>{ @count }</div>   // now * is load-bearing: @count is a cell, the div is reactive
```

Ties directly to `actorization-bundling-2026-05-15.md` (actorization = locality of
behavior): a thing with no behavior to localize doesn't need actorizing, and the
compiler/linter can see that mechanically.

## Status / open

- Direction confirmed in conversation; not implemented.
- `self-becomes-2026-04-14.md` is marked "do not implement without confirming
  direction has settled," and the `tail-return-wire-2026-04-15.md` shapes are
  still unsettled. The constructor-block tail is the half of this that is *not*
  really a value return; settle those wire shapes before locking any surface
  syntax near it.
- The `returns` type keyword is unaffected (declares return type). `return` (yield
  value) pairs with it: `returns Integer` … `return x`.
