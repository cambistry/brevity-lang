# A cell of a class is a pointer — 2026-11-27

Decided with the user on 2026-11-27, as a temporary form. Builds on
`capability-sigils-2026-05-06.md` (call-site `*name` grants a cell) and
`capability-sigils-2026-05-16.md` (`*` actorizes a value type), and on
`reference-fields-in-types-2026-10-26.md` (a reference is data: an address).

## The problem

`*` actorizes a value type: `*Integer` is a cell, an actor holding an Integer. A class's instance
is already an actor, so `c *T = T(4)` made one name mean both the cell and the actor it holds.
`c <- T(6)` had two readings: store a new instance in the cell, or send `$set` to the one it holds.
The targets split. js and rust sent `$set` to the instance (a leftover of the March
`ref b = Box(0); b <- 77` form), so the write did nothing. erlang raised, and rust failed to build
some forms.

But a pointer that can be repointed is needed. A plain name (`b = Box(0)`) already holds an
address, but it can't be rebound. A peer link set after construction (`a.peer <- b`) needs a
pointer, as does swapping one instance for another.

## The form

`*C` on a class declares a pointer cell. As for every cell, a bare name is what the cell holds (the
actor), and `*name` is the cell itself, as in the call-site grant `bump!(*n)`.

```brevity
C = *{ @go = {} }
a = C()
b = C()
cref *C = a
cref = b                  // error: a name is bound once
*cref <- b                // repoints cref at b
cref <- v                 // sends $set to the actor; an error unless C has `set`
cref.go()                 // calls go on the actor
f(cref)                   // passes the actor
f(*cref)                  // grants the pointer to a (p *C) param, which may repoint it
sub *cref, (p C) { … }    // the cell's updates: each repointing
sub cref, …               // error: an actor isn't a cell
```

- **The class check applies to every repointing** (`class-ancestry` ticket): `*cref <- w` for an
  unrelated class is a compile error, as is the declaration `cref *C = w`.
- **`cref <- v` is the actor's `set`.** It compiles only when the class (or an ancestor) declares
  `set`, and its value is checked against `set`'s param.
- **Sugar:** `b = *Box(0)` is `b *Box = Box(0)`, a pointer to a new Box, as `i = *Integer(0)` is
  `i *Integer = 0`.
- **A pointer that may be null is narrowed before use.** In `@peer *class | null = null`,
  `if (@peer)` tests it and `@peer.gossip!(t)` inside the guard calls through it. Outside a guard,
  the call is a compile error, as for any union.
- **A name bound to an actor is not a cell** (`b = Box(0)`, `b Box = …`): `b <- v` is its `set`,
  as for a pointer, and `*b <- v` is an error, since there's no cell to repoint.
- **`*p <- v` takes one value.** `*p <- a, b` is an error.
- **Value cells are unchanged:** `n <- 1` writes, `sub n, …` subscribes, `bump!(*n)` grants. Only a
  cell holding an actor takes `*` on a write or a subscription, because only there does a bare name
  have two possible targets.

### Why the cell is `*name`, not the actor

The user first proposed C's dereference: `cref.go` an error and `*cref.go` the call. But the
call-site grant already gives `*name` the opposite meaning (the cell itself), in
`functions/param_capabilities.test.js` and `operators/ref.test.js`. Following it keeps pointers
consistent with every other cell. "Temporary": the C form may return once the grant has a
spelling of its own.

## Rejected: `Ref[C]`

A value type for an address, written `peer *Ref[class] | null`, with `*` left for value types only.
It's consistent, but at each use it doesn't separate the pointer from the actor.

## Open

- `sub` takes a cell of the actor it's in (`@name`, `#name`), not a local cell, for any cell; so
  `sub *p` on a local pointer is refused with the general error.
- A call-site grant (`f(*p)`) reaches only a local function, for any cell.
- The null rule covers pointers only. A plain local typed `T | null` still compiles a call through
  it unguarded.

## What changes

- Cell writes and repointings store the address on js, erlang and rust, for local and state cells.
  The `$set` forwarding on a cell write moves to `cref <- v`.
- `self/peer.test.js` and `syntax/type_names.test.js`: `a.peer <- b` from outside stays the
  auto-setter. Inside the class, a repointing is `*@peer <- p`.
- `classes/outer_reads.test.js` ("a file cell holding an actor"): unchanged; it only calls through.
- `cam_test/set.test.js` ("child actor via normal dispatch"): `b <- 42` stays, since `Box` has
  `set`.
