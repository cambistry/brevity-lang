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
3. **Reads wait for the value.**
   - **The actor itself** reading a cell before its initializer is a **compile error**
     wherever the compiler can see it: a direct read, or a call to one of the actor's own
     functions that reads it, followed transitively. The actor would be waiting on a line
     it hasn't reached.
   - **Anyone else** (a child, a subscriber) reading it just waits until the value arrives.
4. **Construction and `<-` don't block the sender.** `Child(*total)` hands back the address
   right away, and the block goes on. Only a read waits.
5. **Waiting cycles are detected at runtime** for the cases the compiler can't see (calls
   through function values, reads from other actors). A pending cell records who waits on
   it, and a loop in that record is an error, not a hang.

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

- **Rule 3, the actor's own reads,** is a static check and needs no bus. Without it a
  forward read gives whatever the target holds before initialization; the three targets
  disagree on it today.
- **Rules 2, 4 and 5** need a cell that can be pending, with reads queued behind it. That
  arrives with cells-as-actors. Until then, a child constructed during construction can't
  wait, so handing it a cell before that cell's line stays an error.

## Open

- **`if` and other control flow in a constructor block.** It doesn't parse today, so the
  second case is written in the form it would take.
- **Calls through function values during construction.** The static check can't follow
  them. They're unchecked until runtime cycle detection lands.
