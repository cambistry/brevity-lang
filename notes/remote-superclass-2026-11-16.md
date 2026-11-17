# Remote superclasses — 2026-11-16

Open design question. Not to be implemented yet. Records the problem, the shape of a solution,
and what's left to decide.

## The problem

```brevity
// Svc.bv
T = actor {
  total *Integer = 0
  timeout = 30
  @connect = { … uses timeout … }
}

// main.bv
**
"Svc.bv": :T
**
U = T ++ actor { @fix_total = { total <- total + 1 } }
V = T ++ actor { timeout = 5 }
```

The goal is that inheritance works the same whether the parent is in this file or in another
one, perhaps on another node, behind a trust boundary. By visibility:

- **Public members:** a message. Nothing new.
- **Private members:** never reachable from a subclass, local or not. Nothing new.
- **Protected (bare) members:** the subclass reads, writes and overrides them, and the parent's
  code sees the overrides. Across actors this needs an Opre standard, and an answer to the
  authority question below.

## What this builds on

Settled in discussion on 2026-11-16 (to be written up separately):

- **Inheritance is merged and late-bound.** A subclass overrides a parent's protected function or
  redeclares its cell, and the parent's own code uses the override. The wrapped `sup T ++` form is
  dropped.
- **Class blocks inherit by delegation.** A cell belongs to the block that declares it. A
  subclass's block that doesn't redeclare `total` uses the parent's cell (one cell, shared). One
  that redeclares it has its own, and the parent's code running for that subclass uses the
  subclass's cell. Writes never create a cell; only a declaration does.
- **Spelling:** the parent goes outside the params (`U = T ++ (u Text) *{ } ++ actor { }`). After a
  dot, a public name. After `::`, a bare declared name: a type or a protected member (`class::x`,
  `T::x`). `super.a()` and `super::h()` reach the parent layer. `super[T]` selects a direct parent.

## Locally it's free; remotely the parent layer is an actor

With the parent's source in hand, the compiler merges layers. It knows every override, resolves
late-bound names into a table, and holds both sides' protected names itself. There's no protocol,
because there's no boundary.

Against a remote parent known only by its interface, there's no code to merge. The parent's code
runs where the parent is, so **the parent layer is an actor of its own**, and the subclass
composes with it. Inheritance becomes delegation in the sense of Self and of JavaScript
prototypes: the child receives a message, and what it doesn't define it hands to the parent to
run on its behalf.

## Instances and singletons are one case

A class block is an actor built by a constructor, and so is an instance. "Extend `T`" means
the same thing for both: an actor (the extender) composes with an actor (the parent layer) and
gets protected access to it. The protocol is identical. The difference is only where the parent
layer comes from:

- **Singleton:** `T`'s block already exists, built by the actor that declares `T`. It is one
  layer shared by every extender (`U`, `V`, …), as the delegated-cell rule requires.
- **Instance:** each `U` actor needs its own `T` layer, so it has one built: `$new` on `T`, as a
  layer for this `U`. The layer belongs to that `U` actor alone.

Write that as one operation, roughly "extend this actor". A singleton extender sends it to an
actor that already exists. An instance extender sends it to one it just had built.

## Authority: a grant, not an identity

`T` needs to know that the extender may use its protected names. `T` predates `U` and may know
nothing about it.

- **Protected has never been security.** In Java, C# or Ruby, anyone may subclass a non-final
  class and gain protected access. The only control is `final` or `sealed`. So the question isn't
  "is this really a subclass?" but "does `T` allow itself to be extended, and by whom?"
- **The object-capability answer:** authority is a reference you were given. An extender asks;
  if `T`'s policy allows, `T` replies with a **protected facet**, an address only the holder knows.
  `T` checks no identity, so nothing can be forged; a claim with no facet gets nothing. This fits
  the project's origin: no coordinator is trusted across a trust boundary.
- **It parallels `$new`.** `T` predates its instances too, and anyone may send `$new`. The class
  decides whether to answer, and the requester gets a reference it didn't have.
- **For instances, creation is the natural grant.** The `U` actor that had its `T` layer built
  holds that layer's facet, and nobody else ever sees it. For a singleton, `T`'s block was built by
  `Svc`, not by `U`, so the grant must come from `T`'s own extension policy.

## Open recursion: self travels with the message

Late binding means the parent's code must see the child's overrides:

```
V.connect()   →  V doesn't define @connect: delegate to T, "as V"
T runs @connect, reads timeout  →  V overrides timeout: ask V  →  5
```

- **Self can't live in `T`.** One `T` block serves many extenders at once, so "who am I, right
  now?" has to travel with each delegated call.
- **So the parent holds a facet onto the child too.** It's "the child as its parent sees it": the
  public and protected names the child declares, never its private ones.
- **The handshake is mutual.** The child gets the parent's protected facet; the parent gets the
  child's override facet.

## Settle the overrides at extend time

The parent shouldn't ask "do you override `timeout`?" on every read. The handshake can carry it
once:

- **Child → parent:** the protected names I override (and redeclare), plus my facet.
- **Parent → child:** my protected facet.

The parent then resolves each late-bound name per extender: either a message to self, or local.
A delegated call only says which extender it's for. That's the table the compiler builds for
local merged classes, which is what makes local and remote behave the same.

The override set also catches version skew. If it names something the parent doesn't declare as
protected (renamed, removed, made private), the extension fails at the handshake, not at the first
call.

## Interfaces

A service document lists public members today. An extensible class needs a second section, its
**extension interface**: the protected names and their types that an extender may use and
override. It's published to whoever may extend, which is a policy matter (below). Without it, the
compiler can't check `super::h()` or a redeclaration against a remote parent.

## Costs

- **Round trips.** A protected name the child overrides is a message back to the child every
  time the parent's code reaches it. A cell the child doesn't redeclare is a message to the
  parent every time the child reads it. That's correct under the model, but chatty across a
  network. The child chooses its overrides, so the child pays.
- **Reentrancy.** The parent keeps answering while it waits on self, under the existing reentrant
  turn rule. Two extenders' delegated calls can interleave in one parent.
- **Atomicity.** `total <- total + 1` on a delegated cell is a read, then a `$set`, so updates
  from different extenders can be lost. The atomic block form (a body run as one turn of the cell's
  owner) is the same open question it is locally.
- **Lifetime.** An instance's parent layer lives as long as its child. When the child goes, the
  layer should too, so `T` must know. A singleton's facets outlive any one child.
- **Failure.** If the parent's service is unreachable, the child can't build (instance) or can't
  run inherited code (both). That's how a remote dependency already behaves, but it now applies to
  code the child calls bare.

## Local and remote equivalence

The test of the design: every program that runs with a local parent runs the same with a remote
one, except for timing and the parent's availability.

- **Instance layers:** whether the parent's state is merged into the child's actor (local) or held
  in a layer actor only the child references (remote) makes no observable difference, because
  nobody else can reach the layer.
- **Class blocks:** always delegated, locally too, since the parent block is a live actor that
  others reach (`T.total`, `T::total`).

## Open questions

- **Opre:** how a message says "run this as X" (a self or acting-as header beside `to` and
  `from`). `from-names-calling-scope-2026-11-14.md` is nearby but different: `from` says where a
  reply goes, this says whose definitions win.
- **Default policy:** extensible by default, like Java's non-final classes, or sealed by default
  for anything reached across a trust boundary? How a class declares its policy in source.
- **Who may extend:** anyone; callers that already hold some capability of the parent's; or
  callers named in the parent's DI.
- **Forwarding:** facets are references, so an extender could pass one on. Accept that, as
  object-capability systems do (delegation as a feature, revocation as the remedy), or bind a
  facet to its holder?
- **Revocation:** may a parent withdraw a facet, and what happens to an extender mid-call?
- **Grandparents:** `S → T → U` with all three remote. Does `U` extend `T`'s composite, so that
  `T` holds the `S` facet, or does it hold facets to both? The first keeps `super[T]` to direct
  parents; the second is what reaching an ancestor directly would need.
- **Multiple parents:** two remote parents both calling an overridable `h` on self. Each gets its
  own override facet onto the same child.
- **Code shipping:** when the parent's source is public and trusted, a child could merge it
  locally instead of delegating. Is that ever allowed for a remote class, or is "the parent's code
  runs at the parent" a rule?
