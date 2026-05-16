# Actorization and bundling — the value/actor axis as a footprint knob (2026-05-15)

Status: **clarification** — frames an existing mechanism (the value/actor distinction from the [vocabulary refactor](vocabulary-refactor-2026-05-15.md)) as load-bearing for tree-shaking and library design. Has codegen implications but no language changes.

## The problem

Library types — `List`, `Map`, `Integer` — carry method surfaces: `list.append!(x)`, `map.lookup(k)`, arithmetic and comparison on `Integer`. Where do those methods live in the compiled output, and how much does the developer pay for ones they don't use?

In a JS-style bundler world the answer is "tree-shake them," and tree-shaking is a separate, error-prone pass that guesses at reachability, misses dynamic call sites, and frequently falls back to "include it just in case." The cost is invisible to the developer until they look at bundle size — and the bundler's heuristics aren't authored by the same person who wrote the code.

## The mapping

Brevity's value/actor axis already says where behavior lives:

- **Value** = data only. No methods, no mailbox, no library surface. A value's use costs only the structural shape it travels in.
- **Actor** = data plus its behavior surface. Methods, handlers, projections — the whole library lives where the actor lives.

The compiler's rule then becomes mechanical: scan for `*Type` references; include `Type`'s actor-side library only if at least one appears. Pure-value uses of a Type pull nothing but its wire shape. No reachability guessing, no dead-code heuristics — `*` is a literal opt-in to bundling, and the absence of `*` is a literal opt-out.

- `*List(items)` says: I'll use List's methods here, bundle them.
- `List(items)` says: I'll pass this as data, no methods needed.

## The escape hatch

What if you need behavior but don't want the bundle locally? Host the operations in a dedicated actor and pass values to it.

```
// frontend.bv — small footprint, no List methods bundled
items = ListOps.append(items, new_item)
```

`ListOps` lives somewhere — co-hosted in the same file, in a worker, on a node-level service, or fully remote across the network. The language semantics are identical at the call site because everything is async messaging anyway. **Bundle location follows actor location.**

This stops being aspirational under polyglot: `ListOps` written in Rust serving JS-target clients is the same CAM routing Brevity already does, applied to bundling rather than to feature distribution. No new mechanism required.

## The three positions

| | Syntax | Local bundle | Wire cost |
|---|---|---|---|
| Actorize locally | `*List(items)` + `list.append!(x)` | full method bundle | none |
| Ops actor, co-hosted | `ListOps.append(list, x)` | small co-located bundle | inline / negligible |
| Ops actor, remote | `ListOps.append(list, x)` (remote) | none | per-call wire cost |

Same operation, three cost profiles, all visible in the source. The developer chooses based on what they're optimizing for — bundle size, operation density, locality — without a profiler and without bundler heuristics. One syntactic axis (`*` vs not) and one architectural axis (where the ops actor lives) span the three positions.

## The reframe

The terminology had it that actorization is "promoting a value to a hosted, addressable cell." That description foregrounds state and addressability. Both are true, but they're consequences, not the point.

**Actorization is fundamentally about locality of behavior** — the decision to say *"this type's methods live HERE, with this data."* The address and the mailbox are what you need to make that work; they aren't the point. The point is *where does the behavior sit relative to the data?*

This reframe makes the bundling tradeoff legible without invoking heavier actor-system concepts. A developer choosing between `*List` and bare `List` isn't primarily deciding "do I want a mutable cell or a value" — they're deciding "do I want this type's methods co-located with this data, or hosted elsewhere?" The state and mutability questions are downstream consequences of the locality decision.

It's also the framing that connects most cleanly to Brevity's stated identity. A constrained app-definition language where AI builders and human developers make architectural decisions explicitly, in syntax, with cost models in the code rather than behind a tool. Actorization being a *locality* knob fits that picture; actorization being a *state-promotion* knob is the lower-stakes feature description.

## Codegen consequence

The preamble that ships with compiled output should be assembled by usage analysis on `*Type` references:

- For each Type `T` appearing as `*T(...)` anywhere in the program, include some portion of `T`'s actor-side method bundle in the preamble (how much is refined below).
- For each Type `T` appearing only as `T(...)` (value form), include only `T`'s wire-shape/schema definition.

No reachability analysis on method bodies needed. No "is this call site dynamic?" questions. The `*` is the signal; the rest is mechanical inclusion. How much of the bundle is included depends on how the actorized value is *bound*.

## Visibility and shake granularity

The unit of shake equals the unit of visibility. If every call site is visible to the analyzer, shake; if some are not, include everything that might be visible. Three call shapes have different shake behavior under this rule.

### Free-function form: `List.append(list)`

The function is invoked with the value as an argument; no method dispatch on an actor cell. Shake at function granularity: include `List.append` and its transitive dependencies only. Other `List` functions stay out of the preamble unless called separately. Same shape any tree-shaker treats a named function import.

### Bare local cell: `list = *List(...)`

The cell exists but only in local scope. The analyzer can see every method call site on `list` within the file. Shake at method granularity: include only the methods actually called on this cell, plus their transitive dependencies. Effective shake is similar to the free-function form, just expressed through method calls instead of named imports.

Hedge: if the bare cell flows out of its declaring scope (returned from a handler, passed as an argument to a remote actor), the analyzer's view narrows and the shake degrades. The simple in-scope case shakes cleanly; the cross-boundary case may need to fall back to coarser inclusion. Worth surfacing the degradation explicitly when it happens rather than silently bundling more than expected.

**Forward-declaration for subclass use.** A bare cell can explicitly declare extra methods to bundle — methods the parent class doesn't itself call, but which subclasses will need:

```
list = *List(...) with { sort, filter }   // hypothetical syntax — extra methods to include
```

This preserves per-method shake for the parent's view while supporting inheritance. The alternatives are worse: making the cell public to support subclasses gives up all shake; calling unused methods artificially in the parent is dishonest. Forward-declaration keeps the bundle targeted — the parent's own usage plus the methods the parent has explicitly opted into on behalf of its subclasses, nothing more. It also makes the inheritance contract visible at the declaration site: "this cell's exposed surface to subclasses is exactly this set."

### Public cell: `@list = *List([])`

The `@` accessor exposes `list` to external callers. The analyzer cannot see who will message it or which methods they will call. **No shake possible**: include all methods in `List`'s public interface in the preamble, because any of them could be invoked from outside.

Methods that `List` itself marks private stay private — public exposure of a cell exposes the type's public surface, not its private one. But within the public surface, no further shake is possible.

### Subclass complication

A subclass that uses additional methods of the superclass naturally expands the bundle. The analyzer unions the call sets of subclass and superclass and ships the combined preamble. In-process — subclass and superclass compiled together — this is straightforward.

**When the superclass lives remotely** (different process, possibly different target language), the mechanism needs further design. Open questions: does the subclass's call set ship across to the remote side, narrowing what the superclass's host bundles? Does the remote side ship its full public surface regardless, since other clients might use other methods? Is there a negotiation step at link time?

Not blocking the in-process case; flagged for when remote inheritance becomes a real workload.

### Restricting public surface — wrapper class, not operator

In principle the language could provide a mechanism to explicitly enumerate which methods of a public cell are externally accessible:

```
@list = *List([]) | { append!, lookup }   // hypothetical, not proposed
```

This would re-enable shake by narrowing the visible surface. **The cleaner alternative is usually to compose a wrapper class** that exposes only the surface you want — same outcome, expressed with existing class machinery instead of a new restriction operator. A wrapper class also has a name, can be documented, and can be versioned independently of the underlying type.

The restriction operator might still be worth adding for cases where the wrapper-class ceremony is disproportionate, but the lean is wrapper-class composition first.

## Library design pattern

A library that wants to support both footprint-sensitive and ergonomic uses ships in two affordances:

1. A **value-type** (`::List = (...)`) — the shape, no methods. Callers who don't actorize get nothing but the wire form.
2. An **ops-actor** (a class operating on values of the type). Callers who want behavior without the bundle send messages to it.

Callers who do want the local bundle just actorize: `*List(...)` and call methods directly. Three usage modes, two shipped artifacts, one underlying type.

This is a real onramp story for library design, expressible in one sentence once the vocabulary lands: **provide the value-type and the ops-actor.** Same operations, two packaging stories, one type.

## What this doesn't address

- **Method bundles that depend on other Types.** If `List`'s methods internally use `Iterator`, does actorizing `List` transitively pull `Iterator`'s actor bundle? Likely yes, but the rule needs to be stated explicitly.
- **Mixed-mode usage of the same Type.** When a Type is actorized in one part of the program and used as a value elsewhere, the bundle gets included program-wide; worth confirming the codegen rule handles this without duplicating shape definitions.
- **Remote inheritance shake.** Per the visibility section: when a subclass extends a remote superclass, what gets bundled where is open.
- **Bare-cell shake across boundaries.** When a bare cell flows out of its declaring scope (return value, argument to a remote actor), shake degrades; the mechanism for surfacing that degradation needs design.

These are implementation questions, not direction questions. The direction is settled by the reframe: actorization = locality of behavior, and the compiler can mechanize from there.

## Cross-references

- [`vocabulary-refactor-2026-05-15.md`](vocabulary-refactor-2026-05-15.md) — establishes the value/actor distinction this note depends on.
- [`capability-sigils-2026-05-06.md`](capability-sigils-2026-05-06.md) — prefix `*` as the actorize sigil; the syntactic primitive this note's bundling story attaches to. The addendum on the `*` snowball ("`*` is the universal 'actorize / make instantiable' marker") is the same observation seen from the syntax side; this note is the same observation seen from the codegen/footprint side.
