---
status: investigation
created: 2026-11-26
---
# Investigate: a public class declared in an instance

```brevity
Outer = *{
  @Inner = *{ @v = -> 7 }
}
```

A compile error for now ("a class an instance declares is its own"). A class declared in an
instance body captures that instance's scope, so it lives under the instance
(`#<:Outer:1:~Inner:1>`) and `Inner` of one instance is not `Inner` of another
(notes/class-of-and-self-return-2026-11-23.md). A public one would publish a different class per
instance, which is counterintuitive.

Design thought: support the form by hoisting the class to the class singleton, as if the class
block declared it (`#<:Outer:Inner:1>`, one class). That is sound as long as the nested class
reads no instance cells (or params); one that does can't be hoisted, and stays an error or stays
under the instance.
