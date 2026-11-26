---
created: 2026-11-13
---
# Functions, cells and props: where $get / $set / $subscribe apply

**Depends on:** kanban/finished/wire-ops-and-labels-bare-public-protected-built-ins-cell.md **Background.** Same design note, section "Functions, cells and props". What a member is decides which built-ins apply:

```text
┌──────────┬────────────────┬──────┬────────────┐
  │          │      $get      │ $set │ $subscribe │
  ├──────────┼────────────────┼──────┼────────────┤
  │ cell, &  │ yes            │ no   │ yes        │
  ├──────────┼────────────────┼──────┼────────────┤
  │ cell, *  │ yes            │ yes  │ yes        │
  ├──────────┼────────────────┼──────┼────────────┤
  │ function │ no             │ no   │ yes        │
  ├──────────┼────────────────┼──────┼────────────┤
  │ prop     │ not an address │      │            │
  └──────────┴────────────────┴──────┴────────────┘
```

- A function is an op: {op: [[a, b], 'fn']}. Subscribing makes it an address: {op: [[a, b], '$subscribe'], to: '. fn'}.
- A cell is an address, whether or not it's writable: $get, $set (* only) and $subscribe are sent to . cell.
- A prop is an attribute of its actor and not an actor: {op: 'prop'}. It can't be subscribed to.

Brevity source doesn't change (x.val). The compiler picks the wire form from the service document.

**Scope.**

1. **Service documents:** a new & entry form, val &Integer, for a read-only cell. This goes in the parser in src/codegen/javascript/types.js (parseEntry), the emitter, and parseInterface's __fields. A bare val Integer is a prop and val *Integer is a writable cell.
1. **Reads:** a remote read of a cell compiles to $get sent to … val. A remote read of a prop compiles to {op: 'val'}.
1. **Subscriptions:**
- .subscribe on a cell compiles to $subscribe sent to … val.
- On a function, it compiles to $subscribe sent to … fn, with the function's arguments.
- On a prop, it's a compile error. At runtime, a $subscribe to a prop's name answers unhandled.
1. **Writes:**
- x.val <- v on a prop is a compile error ("not an address").
- On an & cell, it's a compile error (read-only).
- On a * cell, it compiles to $set.
1. **Runtime:** cells answer $get. Functions answer $subscribe at their address. $get and $set sent to a function answer unhandled.
1. **Retirement:** subscribing to a plain read-only field (allowed by session-2026-10-29-service-doc-notation.md) is removed. Fields that tests subscribe to become & cells.
1. **set label (Text):** decide what happens to the service document's write-only setter. Either drop it or make it a write-only cell. Record the decision in the design note.
1. **Outer reads:** a class reading a cell of an actor it's declared in. Today each target does this its own way, inside the process, and none of them uses the wire:
- **JS** hands a $get-shaped message to the parent's receive, marked from: '__child'.
- **Erlang** sends a {bv_outer_get, …} process message.
- **Rust** reads the owner's state map directly, and panics if the cell isn't there yet.

Decide, and record in the design note:

- **What an outer read is.** It could be an ordinary $get sent to the owner's cell, relative to the class, using the same op as item 2. Or it could stay an internal shortcut outside the protocol. If it is a $get: a class is its own actor, so can it read the owner's protected ~ cells? A protected cell otherwise answers only its own actor.
- **What a read of a cell not yet declared does.** JS and Erlang hold the read until the cell's line runs (forward-reads-in-constructor-blocks-2026-11-11.md). Rust has no hold and relies on construction running in text order.
- **When the read happens.** JS and Erlang read asynchronously, so the value is as of the owner's next turn. Rust reads the value at once, with no turn boundary. Under reentrant turns (T2), a race can make Rust see an earlier value than the other targets. This also runs against "everything is async".

Then make all three targets match the decision. If outer reads become $get, JS's internal $get-shaped message is replaced by the real op, and Rust and Erlang gain the same op.

**Out of scope.**

- Capability sigils in source beyond what service documents need.
- Making cell addresses first-class values in Brevity, e.g. passing #<. val> around.
- Call-scoped turns (T3). Item 8 fixes what an outer read sees under today's T2 turns only.

**Tests.**

- Cover each cell of the table above with a wire-level test.
- Add compile errors for subscribing to a prop, writing a prop, and writing an & cell.
- Round-trip & entries through the service-document parser and emitter.
- Migrate the tests that subscribe to plain fields.
- **Outer reads:** for each target, a class reading one of its owner's cells:
- a public cell;
- a protected cell, with whatever item 8 decides;
- a cell whose line hasn't run yet when the class reads it, which waits in every target;
- a cell the owner changes between the class's construction and its read, which every target reads the same way.

**Done when.**

- The table holds in every target.
- Service documents parse and emit &.
- The 10-29 service-doc note gets a pointer to the new rules.
- The set label decision is recorded.
- The outer-read decision is recorded, and JS, Rust and Erlang behave the same on the outer-read tests.
