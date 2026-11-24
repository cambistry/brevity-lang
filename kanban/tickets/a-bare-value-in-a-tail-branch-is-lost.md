---
status: inbox
created: 2026-11-02
---
# A bare value in a tail branch is lost

Problem: a handler ending in if b { "x" } else { 9 } replies {} on JS, in file handlers and classes, because the branch value is computed and dropped. On Rust it doesn't build when the branches have different types. Erlang replies ["x"] or [9].

Done when:

- Each branch's value is the reply on all three targets, in a file handler and in a class.
- It works with branches of the same type and of different types, and for else if chains and nested ifs.
- A branch mixing return with a bare value replies correctly on each path.
- Tagging matches across targets.
- Tests are in __tests__/functions/return_shapes.test.js.
