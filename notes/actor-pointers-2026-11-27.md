# A cell of a class is a pointer — 2026-11-27

Decided in outline: `*C` on a class declares a pointer, and a prefix `*` dereferences it. The
form is borrowed from C. Points 1–4 below are proposals, not settled.

Builds on `capability-sigils-2026-05-16.md` (`*` actorizes a value type) and
`reference-fields-in-types-2026-10-26.md` (a reference is data: an address). Rejected
alternative: a `Ref[C]` value type (below).

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

```brevity
C = *{ @go = {} }
a = C()
b = C()
cref *C = a
cref = b        // error: a name is bound once
cref <- b       // repoints cref at b
cref.go         // error: cref is the pointer, not the actor
*cref.go        // calls go on the actor cref points to
```

- **`*C` on a class is a pointer cell.** It holds an address of a C or of a subclass of C.
- **A prefix `*` dereferences it.** `*cref` is the actor.
- **`<-` has one meaning: write what the left side names.** `cref <- b` repoints the pointer, and
  `*cref <- 42` sends `$set` to the actor (its `set`).
- **The cell and the actor are each reachable.** `cref.subscribe` watches the pointer being
  repointed, and `*cref.x.subscribe` watches the actor's `x`.
- **Sugar:** `b = *Box(0)` is `b *Box = Box(0)`, a pointer to a new Box, as `i = *Integer(0)` is
  `i *Integer = 0`.
- **Params:** `*` on a param already means "may write". `(p *C)` takes a pointer the callee may
  repoint, like C's pointer to a pointer.
- **Class check:** a pointer is declared, initialised and repointed only with a C or a subclass
  (`class-ancestry` ticket). `cref <- w` for an unrelated class is a compile error.

### Parsing

In an expression, a prefix `*` today takes only a constructor (`*Integer(0)`, `*Box(0)`); `*n`
alone is a parse error, so the dereference doesn't collide. `2 *y` stays multiplication, because
a prefix `*` appears only where an operand is expected.

## Proposals (not settled)

1. **Precedence differs from C.** In C, `*p.go` is `*(p.go)`; C programmers write `(*p).go` or
   `p->go`. Here `*cref.go` dereferences `cref` first: a prefix `*` binds tighter than `.`.
   `*a.b.c` dereferences only `a`, so a pointer held in a field takes `*(a.next).go`.
2. **A bare pointer as a value.** `f(*cref)` passes the actor. `f(cref)` passes the pointer, so the
   callee sees later repointing. Only a `(p *C)` param takes one.
3. **Value cells stay implicit.** `n *Integer` reads as `n`, never `*n`. A dereference is needed
   only where the cell holds an actor, because only there does `.` have two possible targets.
4. **Null.** In `@peer *class | null = null`, `if (@peer)` tests the pointer, and
   `*@peer.gossip!(t)` calls through it. Dereferencing a pointer that may be null is a compile
   error until a guard narrows it, as for any union.

## Rejected: `Ref[C]`

A value type for an address, written `peer *Ref[class] | null`, with `*` left for value types
only. It's consistent, but it says less than the C form: it doesn't separate the pointer from the
actor at each use, so `peer.x` still has two possible targets.

## What changes

- `self/peer.test.js` and `syntax/type_names.test.js`: `@peer.gossip!(t)` becomes
  `*@peer.gossip!(t)`.
- `classes/outer_reads.test.js` ("a file cell holding an actor"): `counter.get()` becomes
  `*counter.get()`.
- `cam_test/set.test.js` ("child actor via normal dispatch"): `b <- 42` becomes `*b <- 42`.
- A `.` on a class-typed cell is a compile error. The `$set` forwarding in each target's cell-write
  codegen goes.
