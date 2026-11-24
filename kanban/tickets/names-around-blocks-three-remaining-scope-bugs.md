---
status: done
created: 2026-11-02
---
# Names around blocks: three remaining scope bugs

  Problem:

‌

1. A rebind after a branch changes what the branch reads, on Rust and Erlang:

     r = 5; if c { return r }; r = 6; return r replies [6] from the branch. JS replies [5].

     These targets run a non-leading branch after all the body's locals, so the locals' side effects also run too early.

‌

1. A typed shadow directly in a loop body is ignored on JS, Rust and Erlang:

     r Integer = 5; repeat while c { r Integer = 2; return r } replies [5].

     A branch inside a loop already works.

‌

1. The re-bind rule is inconsistent:

     An untyped x = … on an outer name is a compile error inside y = if { … } and repeat while, but is allowed in a statement if.

‌

  Done when:

‌

- The branch in (1) replies [5] on JS, Rust and Erlang, and the path that skips it replies [6].

- A local bound after a branch has no side effects if the branch returns, on all three targets.

- The loop body in (2) replies [2] on all three targets, and a loop that never runs replies [5].

- There's a decision on (3): either untyped rebinds stay allowed in a statement if, and the difference is documented, or they become a compile error 

  everywhere.

- Tests cover each of these.
