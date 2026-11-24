---
status: inbox
created: 2026-11-03
---
# A call to a file's own typed overload picks the clause by arity only

Problem: When a file calls one of its own overloaded functions, the clause is chosen by arity alone. Arg types are ignored, so the first clause with a matching arity runs:

```brevity
pick = (n Integer) { return "a" }
pick << (n Text) { return 1 }
@g = (v Text) {
  return pick(v)        // runs (n Integer), and @g fails
}
```

@g("z") replies ex: { '@g': 'error' }. It should reply 1. Called with an Integer, it correctly returns "a". Public handlers behave the same way: @pick / @pick << … called as @pick(v) from @g fails too.

The compile-time annotation check follows the language's rule (first clause whose types accept the args). So at run time, a different clause can run from the one the compiler judged.

What exists: the JS clause guard is built in src/codegen/javascript/classes.js:199 and :204:

```
(from === '__parent' || from === '__self' || from === '__test' || ${typeCondition})
```

Messages from __self, __parent and __test skip _matchTypes entirely. A self-call sends [[v], "pick"] without a ty tag, so there are no types to match even without the bypass. Either the self-send has to carry tags, or the guard has to check the values' runtime types for in-process senders. Rust and Erlang haven't been checked; they may have the same bypass.

To decide: should trusted in-process senders (__parent, __test) also be type-matched, or only __self?

Done when: pick(v) with v Text runs the (n Text) clause on every target, and a call whose args match no clause's types fails the same way as a call from outside.
