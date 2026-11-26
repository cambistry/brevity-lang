# `sub`: subscription is a keyword form — 2026-11-26

Supersedes, in `subscription-via-multi-re-2026-04-18.md`, the "Surface syntax" section and the
"`subscribe` is not a reserved keyword" answer under "What this resolves". The wire model there
(a subscription is an op whose callee keeps replying under one id) stands.

## Decision

- **A subscription is `sub subject, handler`,** in the forms `over` takes: `sub(subject, fn)`,
  `sub(subject) block`, `sub subject, fn`, `sub subject block`.
- **The subject is what is subscribed to, written as it's read or called:** a param `n`, a
  child's cell `c.x`, an own cell `@pub`, a private handler `#priv`. A call carries the
  subscription's args: `sub c.pub(p: 100), (v) { … }`.
- **The handler is a function or a reference to one** (`&f`, a function of the actor or of one
  it is declared in). Its params bind each delivered value under the normal destructuring rules,
  so any subset is fine, none included: `sub @pub, () { pings <- pings + 1 }` is a ping that
  something changed. A reference is the lambda that calls it with its own params.
- **`sub` is reserved; `subscribe` is not.** `@subscribe` is an ordinary name, and
  `x.subscribe (v) { }` is an ordinary (bad) call.
- **The wire op is `$sub`,** the intrinsic sent to the subject, with its args, as `$subscribe`
  was. Nothing else on the wire changes.

## Reasons

- Subscription was never a method a value defines: the parser special-cased `.subscribe`, and
  the op was the protocol's. A keyword says so.
- It reads like `over`: the thing, then what to do with each value.
