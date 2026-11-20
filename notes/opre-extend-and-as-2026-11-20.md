# Opre: `$extend` and `as` — extending an actor — 2026-11-20

Decided in discussion, except where marked open. An Opre standard: any actor may extend or be
extended, whatever language either is written in. Answers the protocol questions of
`remote-superclass-2026-11-16.md` for one parent layer; the Brevity mapping and the first phase
are at the end.

## The shape

An extender (the child) composes with an actor it extends (the parent). The child reaches the
parent's protected names; the parent's code, run for the child, uses the child's overrides
(late binding). Both are actors, and everything between them is a message.

```js
// child class → parent class, once: the child's overrides, in the parent's terms
{ op: [[{ block: ['timeout', '~h'], instance: ['~step'] }], '$extend'], to: 'Svc:T', from: ':' }
{ re: [], to: ':' }                                    // accepted (or an `ex` reply)

// a delegated call: run T's @connect, for the sender
{ op: 'connect', to: 'Svc:T', from: ':', as: ':' }

// T, running @connect for V, reads a cell V redeclares
{ op: '$get', to: '<V>:~timeout', from: 'Svc:T' }

// the child reads a protected cell of the parent's it doesn't redeclare
{ op: '$get', to: 'Svc:T:~total', from: ':' }
```

## Identity: `from`

- The parent knows which child it is talking to from `from`. The routing tree stamps it (a
  parent translates addresses, not the sender), and across a trust boundary it is as good as
  the link's authentication.
- There is no facet address. The child talks to the parent at the parent's own address.
- `$extend` makes a record in the parent: this sender is an extender, with this override table.
  The record is the authority. It is keyed by the extending class's address, and covers any
  sender under it: an instance of the class has an address under the class's (`<main>:U:1` is
  under `<main>:U`), and `from` is stamped, so that is as trustworthy as `from`.
- **A record can't be forwarded.** It is keyed by `from` (and `as`), so an extender holds nothing
  it could hand to a third party. Only a direct extender registers contexts, for its own subtree
  (see "Grandparents").

## `$extend`

- **Between classes, once.** A class extends a class; the handshake is never per instance.
  A class's address serves both its class block and its `new` (`$new` to `:C` builds a `C`, and
  `C`'s members answer at `:C`), so one `$extend` covers both levels.
- **Request:** the child's override table: the parent's public and protected names that the
  child overrides (functions) or redeclares (cells), in two sections, `block` (class members) and
  `instance` (an instance's members), since those are different interfaces. Names are in the
  parent's terms; protected ones carry `~`.
- **The child computes the table at compile time,** against the parent's published extension
  doc (below), which is also where the child's compiler checks it: an override of a name the
  parent doesn't have, or of another type, is a compile error in the child.
- **Reply:** an acknowledgement, or a failure, as the ordinary `ex` reply of any failed op. No
  document: the child compiled against the parent's.
- **The parent checks** that every name in the table is one it declares, public or protected.
  A mismatch (a name renamed, removed or made private since the child compiled) fails the
  `$extend`, so version skew fails at the handshake, not at the first call.

It is a round trip, not a cycle. The parent's code is compiled once against its own doc and
reads a per-extender table at run time; the child's compile depends on the parent's doc; the
parent's table depends on the child, as data. (C++'s vtables split the same way.)

## `as`: a delegated call

- `as: ':'` says: run this as my delegate. The entry op runs the parent's own definition;
  every public or protected name it reaches, itself included, resolves through the sender's
  override table: an override goes to the child, anything else is the parent's own.
- **Without `as`, a call runs as the parent,** as a stranger's call does. So a child naming its
  parent explicitly (Brevity's `T.f()`) gets the parent's own behaviour, its own `timeout`
  included, while `super` and a name the child doesn't define send `as`.
- `as` is an address, translated on the way as `from` is. It equals `from`, or names a context
  `from` registered with `$extend` (below); the sender must be a recorded extender. Anything else
  is refused. (Naming an arbitrary third party would need a capability for it, not a claim.)
- A cell access (`$get`, `$set` of a `~` name) runs no code, so it needs no `as`.

## Grandparents: `as` travels, nobody talks past their direct parent

`T` ← `V` ← `W`: `W` extends `V`, which extends `T`.

```
T = *{} ^ { timeout = 30; h = -> 1; @connect = { … reads timeout, calls h … } }
V = T ^ { h = -> 2 }
W = V ^ { timeout = 5 }
W.connect()   →  T's @connect, for W: timeout 5 (W's), h 2 (V's)
```

- Each actor talks only to its direct parent and its direct extenders. `W` never reaches `T`,
  and needn't know it exists: `W` compiled against `V`'s composite doc, and `V`'s parent is
  `V`'s business.
- **A delegated call is forwarded with its `as`.** `W` sends `connect` to `V` with `as: ':'`
  (`<W>` at `V`); `V` doesn't define it, so it sends it on to `T` with `from: <V>, as: <W>`.
- **A direct extender registers its own extenders with its parent.** When `W` extends `V`, `V`
  sends `T` a `$extend` with `as: <W>`, whose table is the names `V` or `W` overrides, in `T`'s
  terms. `T` keys its records by `(from, as)`: a precise table for each run context, while it
  still talks only to `V`.

  ```js
  { op: [[{ block: ['timeout', '~h'] }], '$extend'], to: 'Svc:T', from: ':', as: '<W>' }
  ```

- **Callbacks go to `from`, with the same `as`.** `T`, running for `(V, W)`, asks `V` for
  `timeout` and `h`; `V` resolves each for `W`: `timeout` from `W`, `h` from itself.
- Authority is unchanged: `T` trusts only `V`, its recorded extender, and `V` speaks for its own
  subtree. A wrong `as` from `V` can only misdirect calls back into `V`.
- `super[T]` names direct parents only, which this keeps.
- Costs: one more `$extend` hop per level when a descendant extends; a callback walks back
  down the chain (`T` → `V` → `W`), longer with depth.

## Several parents

- Each parent keeps its own record of the child. `super[A]` / `super[B]` pick which parent a
  delegated call goes to.
- **The override table is the child's composite:** the names, in that parent's terms, that the
  child's whole interface supplies in place of the parent's own: what it declares, and what it
  gets from its other parents, the later parent winning (the local rule, "several parents;
  later wins"). So in `C = A ^ B`, `A`'s code calling a late-bound `h` that only `B` defines asks
  `C`, which delegates it to `B` with `as`.
- **A diamond of class blocks** (`A` and `B` extend `S`, `C = A ^ B`) is fine: `S`'s block is
  one actor, with contexts `(A, C)` and `(B, C)` registered through each side.
- **A diamond of instance layers is an error, for now.** Each layer belongs to the instance that
  built it, so `C`'s `A` and `B` layers would each build their own `S`: two `S` states, where the
  local merge keeps one. Whether to duplicate or share is decided when instance layers are
  built.

## Protected names on the wire

- Protected names carry `~`, as now.
- The parent accepts a `~` op only from a recorded extender. The child accepts a `~` op only
  from the parent it extended.
- Private names are never reachable through either side.

## The extension doc

- An extensible actor publishes, beside its service doc, its **extension doc**: its public and
  protected functions (name, arity, types) and its protected cells (name, type).
- So every protected declaration is published, in case something extends the actor. The cost
  is compile time and document size.
- **Every actor is extensible, for now.** There is no sealing, so every actor publishes its
  extension doc and any actor may extend it. A security layer (sealing, a policy for who may
  extend, extensible only within a trust boundary) is deferred, not rejected.
- A child's own extension doc, for its extenders, presents the composite interface: its own
  names and what it inherits.

## Instance layers

- An instance's parent layer is built by `super(args)`: a `$new` of the parent class, marked
  `as`, which makes the new actor a layer for the sender rather than an ordinary instance.

  ```js
  { op: [[args], '$new'], to: 'Svc:T', from: ':', as: ':' }   // build a T as my layer
  ```

- The parent class accepts it only from a sender under a recorded extender. The layer resolves
  its late-bound names through that extender's `instance` table, recorded at the class
  handshake, and reaches the instance that built it for the overrides.
- The layer is that instance's alone: it isn't published, and no one else can reach it.
- An unreachable parent needs nothing new: `super`'s `$new` fails, so the child isn't built, and
  a delegated call fails as any call to an unreachable dependency does.
- Delegated calls and `~` access between an instance and its layer follow the same rules as
  between blocks.

## In Brevity

- A class block that extends another (`B = A ^ { … }`) sends `$extend` to the parent block when
  it is built.
- `super`, and a name the block doesn't define, send `as: ':'`. `A.f()` from `B`'s block sends
  no `as`.
- A cell `B` doesn't redeclare is read and written at `A` (`$get` / `$set` of `~name`); one it
  redeclares is `B`'s, and `A`'s code running for `B` reaches it at `B`.
- `base::h()` is `super` named explicitly: a delegated call of `A`'s `h`.

## Phase 1

- Class blocks only, one parent block each, at any depth. The compiler sends `$extend` as the
  block is built (and a block registers its own extenders with its parent, as above),
  filling only the `block` section; policy waits for the security layer. The record is keyed by
  the block's address, which is the class's.
- Delegation replaces the copying of the parent block's functions into the child block, and
  `~` ops replace the inside-the-chain privilege the child uses today for the parent's cells.
- Every target. Tests in wire-visible outcomes, the same as for the local blocks today.

## Open

- **The security layer:** sealing, who may extend, extension across a trust boundary, and
  revoking an extender's record by policy (and what an extender mid-call sees then). Deferred:
  every actor is extensible for now (see "The extension doc"). Until then `$extend` fails only
  as any op does, on an error such as version skew.
- **Lifetime:** deferred until CAM has a notion of an actor ending (reference counting,
  garbage collection, or monitoring). Until then an instance layer and an extender's record live
  as long as their parent. That's no loss for class blocks, which live for the whole program;
  for instance layers it leaks. Either an explicit `$drop` from the child or the parent
  monitoring its extenders is the likely end state.
