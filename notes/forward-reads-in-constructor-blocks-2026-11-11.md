# Forward reads in a constructor block — 2026-11-11

Design decision: how a constructor block treats a cell that is used before the line that
declares it. Written with cells-as-actors in mind (each cell answers its own `get` / `set`;
see `protected-names-dot-prefix-2026-11-11.md`). The first rule below holds with or without
that change.

## The rule

1. **Text order.** A constructor block runs top to bottom. Nothing is hoisted, and no
   initializer runs early because something reads its cell. A line means what it says where
   it stands.
2. **A cell's address exists from the actor's start; its value arrives at its line.**
   Referring to a cell before its line (passing it as a reference, subscribing to it,
   capturing it in a function that isn't called yet) is fine.
3. **Before its line, the actor can only hand out a cell's address.**
   - **The actor itself** reading or writing a cell before its initializer is a **compile
     error** wherever the compiler can see it: a direct use, or a call to one of the actor's
     own functions that uses it, followed transitively. A read would wait on a line the
     actor hasn't reached. A write has no meaning: applied before the initializer it's lost;
     queued behind it, it lands after the line it precedes, against text order.
   - **Anyone else** (a child, a subscriber, an actor handed the reference) reading it just
     waits until the value arrives.
4. **Construction and `<-` don't block the sender.** `Child(*total)` hands back the address
   right away, and the block goes on. Only a read waits.
5. **Waiting cycles are detected at runtime** for the cases the compiler can't see (calls
   through function values, reads from other actors). A pending cell records who waits on
   it, and a loop in that record is an error, not a hang. The plain case: the cell's owner
   is blocked awaiting a reply from actor X, and a read waiting on the cell came from X.
   X can't reply until it's answered, and the cell can't be answered until the owner gets
   past the call.

## Cases

```
x Integer = y            // error: 'y' is read before its declaration
y *Integer = x
```

```
(special Boolean) *{
  if (special) { sys_param <- sys_param + 1 }   // error: read before declaration
  val Integer = sys_param
  @val = { val }
  sys_param *Integer = 123                      // fix: move this line to the top
}
```

```
kid = Child(*total)      // fine: the address exists; a read by Child waits
total *Integer = 0       // Child's read is answered once this line runs
```

```
(:Svc) *{
  z <- 2                 // error: the actor writes z before its declaration
  Svc.init(&z)           // fine, unless Svc reads z while handling init: then a cycle (rule 5)
  Svc.fn(z as Integer)   // error: the actor reads z before its declaration
  z *Integer = 1
}
```

`Svc.init(&z)` awaits a reply. If `Svc` only stores the reference, or reads `z` after
replying, its read waits and is answered at `z`'s line. If it reads `z` while handling
`init`, `Svc` waits on `z`, `z` waits on its line, and the line waits on `Svc`. The compiler
can't see which: `Svc` is another actor. A fire-and-forget `Svc.init(&z)...` never cycles.

## Rejected

- **Definitions first:** run every `=` in dependency order, then the statements. This
  ignores where a statement stands; in the second case, `val` would be 123 even though the
  increment comes first.
- **On demand:** run a cell's initializer the first time it's read. In the second case this
  gives the 124 the author probably meant. But a distant read can change a value:

  ```
  a *Integer = 1
  log Integer = b    // with this line b = 1; without it b = 99
  a <- 99
  b Integer = a
  ```

## Staging

- **Rule 3, the actor's own reads and writes,** is a static check and needs no bus. (Its
  writes were already refused by the parser, which doesn't know the name yet.) Without it a
  forward read gives whatever the target holds before initialization; the three targets
  disagree on it today.
- **Rules 2, 4 and 5** need a cell that can be pending, with reads queued behind it. That
  arrives with cells-as-actors. Until then, a child constructed during construction can't
  wait, so handing it a cell before that cell's line stays an error.
- **The one cross-actor read that exists today** is a nested class reading a cell of the
  class around it (`get@late` to the enclosing actor). It could queue on a pending cell
  before cells become actors, but only if constructing the nested class stops blocking the
  parent; otherwise the queue turns a wrong value into a deadlock.

## Open

- **`if` and other control flow in a constructor block.** It doesn't parse today, so the
  second case is written in the form it would take.
- **Calls through function values during construction.** The static check can't follow
  them. They're unchecked until runtime cycle detection lands.
