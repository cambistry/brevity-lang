---
status: done
created: 2026-04-15
---
# File-level return-as object/value

Primary concern is: what it the wire expression?

The interface will express possibly output coercions.

First question is around “getting” the whole object. Without coercions, this doesn’t really make any sense. What do you mean, “get” an object? You already have it (its address) or you wouldn’t be talking to it!

This is different than another object handing it to you, of course.

However it does make sense to ask an object what it becomes if cast to a particular type. (This even makes sense at construction time, if you are not interested in being able to directly address the wrapper actor.)

actor.bv

```
self as Integer = -> 42
```

```
<"actor.bv": A*>
=
a = A()
x Integer = a // 42

OR

x Integer = A() // 42
```

In the first case, we already have a wire protocol for returning a reference to an actor (`“re": {}, ”bv-a”: “self<A>”` here). The response for the second case is also pretty clear: `”re”: [42], “bv-a”: [Integer]`.

The new territory is the question.

```
{"op": "::as::Integer"} // sent to an existing actor
{"op": "::new::as::Integer"} // construction and projection in one pass?
```

All those semicolons are getting ugly though. And I’m not quite sure what they mean.

SOLUTION:

```
{"op": ["Integer", "as"] ...}
```
