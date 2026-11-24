---
status: inbox
created: 2026-11-04
---
# JS: a class can't subscribe to a file's private cell passed to it as a param

A class that takes a cell param and subscribes to it works when the file passes a published cell (Reader(P: @n)). It fails when the file passes a private one (Reader(P: n)).

```brevity
n *Integer = 0
Reader = (:P *Integer) *{
  seen *Integer = 0
  P.subscribe (v Integer) { seen <- v }
  @seen = { return seen }
}
r = Reader(P: n)
@look = { x Integer = r.seen(); return x }
@bump! = { n <- n + 1 }
```

@bump! then @look should reply [1]. On JS it replies [0], and the class throws TypeError: pending.reject is not a function. Erlang replies [1]. Rust is untested.

Two faults:

- **Wrong selector.** The file passes the handle {host: this, cell: "n"}. The class's subscribe sends { op: "@subscribe", to: '@' + this.#b_P.cell, from: '__parent', … } to the host, so it asks for @n. The file has no @n, only a private n, so it answers with an ex. The send is emitted by the subscribe codegen in src/codegen/javascript/statements.js. The @ prefix is hard-coded for the cell-handle case.
- **Subscriptions can't take an ex.** A subscription's pending entry is { persistent: true, handler } with no reject. receive calls pending.reject(message.ex) on any ex whose id matches a pending entry (src/codegen/javascript/classes.js, in the 'ex' in message branch), so it crashes rather than failing the subscription.

Fix direction:

- The handle should say which cell it means, private or published, and the host should accept a subscribe to a private cell from a class it handed that cell to. Passing n as a param grants access to it. Don't map a private n to #n: n, @n and #n are different labels.
- An ex on a persistent subscription should end the subscription cleanly instead of crashing. Report it, or drop the entry.

Tests:

- The script above with private n: @bump! then @look replies [1], on every target.
- The same with published @n, which already passes, as a control.
- A subscription that gets an ex back doesn't crash the class.
- In __tests__/classes/outer_reads.test.js, "a class reaches its file actor while the file actor is idle" uses @n to avoid this bug. Once it's fixed, a private-n version of the two subscription tests can go in alongside.
