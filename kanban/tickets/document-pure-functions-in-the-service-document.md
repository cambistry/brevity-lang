---
status: inbox
created: 2026-11-25
---
# Document pure functions in the service document

A signature's `writes` key says whether a call changes state (`notes/opre-type-encoding-2026-11-21.md`: `false`, `true`, `"untracked"`, or omitted for no claim). It tells a caller whether a call is safe to repeat. Nothing says whether a call is **pure**, which tells a caller more: the result depends only on the arguments, so the call can be cached, inlined, reordered or run anywhere.

**Pure:** a function that holds no state, reads no external mutable actor or cell except through its params, and calls only pure functions. It may create actors, internal or external, if their implementations are pure, and message them.

**Representation.** Purity implies not writing, so the two keys aren't independent. Options:

- A parallel key, `"pure": true`, beside `"writes": false`. Simple, but allows the impossible `pure: true, writes: true`.
- One ordered key for the effect level: `pure` < reads < writes, with `untracked` as before. No impossible combinations, but it replaces a key that's already emitted.

**Idempotence: needs further design discussion; not part of this ticket's work.** A writing call whose repeat leaves the same state as one call is safe to retry, which matters for at-least-once delivery (HTTP's split: GET is safe, PUT and DELETE idempotent, POST neither). Ordered levels would be pure < reads < idempotent < writes. Ideas so far, none settled:

- **A conservative rule** proves the common case: no write reads a cell the function writes, anywhere in it (`x <- 5` is idempotent; `x <- x + 1` isn't; nor is `a <- b` then `b <- 2`), and every call is to an idempotent, non-writing or pure function.
- **Idempotence belongs to the whole function, not its parts.** Real idempotent operations guard non-idempotent steps (create only if missing, append unless present, dedupe by request id), which the rule can't see.
- **An unchecked author's claim is too weak** for a language feature. The direction that looked principled: put the trust in a small, audited set of library primitives (`put!!`, `remove!!`, `add!!` on a set, `ensure!!`), and require user code marked idempotent to be provable from those and the rule, so a hand-written guard stays plain `!`.
- **Marking it `!!`** on the name ("saying it twice changes nothing"), shown at every call site by name matching. Overrides may strengthen `!` to `!!` but not weaken. Cost: elsewhere more marks mean more danger; here the second `!` means safer.
- **Testing** can check a claim where the compiler can't: call twice, compare the state (a Tensile check).

**Source.** Purity can be inferred, since every condition is checkable from the body and the callees' documents (as `writes` is checked against `!`). Decide whether source can also assert it, so the compiler refuses a function that stops being pure.

Uses waiting on it: type namespaces need their functions pure, not just non-writing (`notes/type-namespaces-2026-11-25.md`), and `get-pure-function-enforcement` asks for the same guarantee on `get`.
