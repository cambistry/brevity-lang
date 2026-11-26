---
status: inbox
created: 2026-11-14
---
# `::` reaches a constant nested more than one level

One level works: from A's family, `A::k` reads a constant in A's class block.

Two levels don't. With a class `B` declared in A's class block:

```brevity
A = (s Integer) *{
  @f = { x Integer = A::B::k; return x }
} ^ {
  B = (t Integer) *{} ^ { k = 3 }
}
```

→ "'A::B::k' is a type, not a value", from A's family as well as from outside. `A::B.k` (a public `@k` in B's block) fails to parse ("Unexpected '.'").

The error comes from `src/singleton_classes.js:813`/`:814`, the fallback once the chain isn't a protected member.

To decide: who may read `A::B::k`. B is a protected member of A, and `k` is protected in B's block, so A's family reaches `B` but isn't B's family.

Done when, on js, rust and erlang, `A::B::k` and `A::B.k` read under that rule, and a reader outside it gets the same kind of compile error one level gives today.
