---
status: done
created: 2026-11-15
---
# Spec method chaining both on self and other

actor = Class().tweak!(123)

If `tweak!` is a function on the class itself, then this should return the actor address. Rough Opre:

{ op: [“$new”, [123], “tweak!”], ty: [“Integer”], to: “Class” }

Further, the compiler should auto-optimize:

```
actor = Class()
actor.tweak!(123)
```

Should produce the same chain, since tweak! cannot change the value of `actor`.

Open question: can the following be chained as well?

```
a = Class()
a.val <- 100
```

As above, the $set operation does not update `a`, so this should not require a second round trip. However the $set is targeting a child actor \@‌val. Spelled out, this is:

{ op: “$new”, to: “Class” }
{ re: “#<Class 1>“, ty: “Class”, from: “Class” }
{ op: [100, “$set”], to: “Class 1 val”, ty: [“Integer”] }

It is not as simple as `op: [“$new”, 100, “$set”]` since that fails to specify the field target. Moreover, it is not as simple as (somehow) switching “self” pointers either, since the goal is to return the new actor address, not the child actor.

It suggests a subquery (subop) syntax.

op: [“$new”, { op: [100, “$set”], to: “:val” }]

Two problems: 1) how is this distinguished from an argument list? and 2) this reads to me as a change of “self” to “. val”, not a subop.

The second can just be a matter of convention, so not super worried.

The rigorous solution for the first is that arg lists must always be contained in an array []. Eliminating the {} shorthand for [{}]. Frankly, that was a bit dubious anyway. {} is unambiguously subquery. A subquery only works on an actor (since the inner subjects need to be addressable). So the convention is that after the subquery, the target returns to the containing actor, and returns (if requested).

Reminder: the way to force a silent call is simply to omit the `id` field in the request.
