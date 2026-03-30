# Forward References in Brevity: Self-Sends, Not Closures

## The Problem

Brevity leans heavily into lambda structure. Syntactically, everything looks like an anonymous function — both the inline form (`fn = |x| x + 1`) and the spacious form. This creates a forward reference problem: what happens when a lambda body references a name that hasn't been bound yet?

```
not_a_handler = -> double(1) + 1
x = expensive_computation()
double = |n| n * x
```

The naive instinct is to either hoist definitions or defer closure evaluation. Both are wrong. Hoisting breaks sequential construction semantics. Deferred evaluation raises the question: deferred until *when*?

## Closures Don't Solve This

Consider lazy instantiation as an approach:

```
x = -> z(1) + 1
z = |n| n * 2
y = x()
```

When `x` is defined, it closes over its environment. But `z` doesn't exist in the environment at closure time. If we evaluate `x()` later, the closure was already captured — `z` isn't in it. For that to work, the closure would have to be rebuilt or re-scoped at invocation time. That's not a closure anymore.

The question becomes: what right does `z` have to suddenly appear after the closure has been captured?

## The Insight: Handler Names Are Self-Sends

The answer: `z` is not a value. It's a message to `self`.

When a lambda body says `z(1)`, it doesn't close over the *value* of `z`. It compiles to a self-send: `{op: ["1", "z"]}`. The lambda captures `self`, not `z`. And `self`'s ability to handle `op: "z"` is a property of the fully-constructed actor, not of whatever was in lexical scope at lambda definition time.

So the compiler rule is:

> Within a constructor body, a bare name call like `z(1)` inside a lambda is a **self-send**. The compiler verifies that by the end of the constructor, `self` can handle that message. Order of definition doesn't matter — membership does.

```
x = -> z(1) + 1    # body compiles as self-send: {op: ["1", "z"]}
z = |n| n * 2       # registers handler for op: "z" on self
```

Both of these orderings are valid:

```
# Order A
x = -> z(1) + 1
z = |n| n * 2

# Order B
z = |n| n * 2
x = -> z(1) + 1
```

And this is a compiler error:

```
x = -> w(1) + 1    # self-send to "w"
z = |n| n * 2       # no "w" handler anywhere
# ERROR: actor has no handler for `w`
```

## The Load-Bearing Distinction: Handlers vs Values

This only works because the compiler can distinguish a callable binding from a value binding. `z = |n| n * 2` registers a handler on `self`. `z = 42` binds a value. Only the handler form makes `z` a valid self-send target. A lambda referencing a plain value binding still closes over it normally — the value must exist at closure time.

## Construction Is Sequential

There's a constraint on top of the membership rule: **you cannot invoke a self-send during construction before the target handler has been defined**.

The constructor runs top-to-bottom. At any point during construction, `self` can handle whatever handlers have been registered *so far*. If you invoke a lambda that self-sends to a handler that's already been registered, that's fine — `self` knows what to do with that message.

```
z = |n| n * 2
x = -> z(1) + 1
y = x()             # FINE — z is already registered
```

But if the handler hasn't been registered yet at the point of invocation:

```
x = -> z(1) + 1
y = x()             # ERROR — z not registered yet
z = |n| n * 2
```

The *definition* of `x` is fine in both cases — it just captures the intent to self-send. The *invocation* `x()` forces dispatch, and at that moment, `self` either knows `z` or it doesn't.

## How Handlers Get Forward References "For Free"

Public handlers (`@get`, etc.) never have this problem. No external caller can invoke `@get` until the actor is fully constructed and `self` is returned. The constructor *is* the scope boundary that guarantees all names are bound before any handler fires.

```
@get = -> double(1) * 2
x = expensive_computation()
double = |n| n * x
```

This is fine. `@get` contains a self-send to `double`. By the time anyone can send `{op: "get"}` to this actor, the constructor has finished, `double` is registered, and `self` can handle it.

Handlers don't get special forward-reference privileges. They follow the same rule as everything else. They just happen to *structurally satisfy* the call-site constraint, because their invocation is always post-construction.

## Summary

Two rules, one principle:

1. **Membership rule.** A lambda body may reference handler names as self-sends. The compiler verifies those names exist as handlers somewhere in the actor definition. Order of definition doesn't matter for the *reference*.

2. **Sequential construction rule.** Invocation of a lambda containing self-sends during construction is only valid if the target handlers have already been registered at that point in the constructor. Order matters for *invocation*.

**Principle:** The forward reference problem was never a scoping problem. It was a messaging problem wearing scoping clothes.
