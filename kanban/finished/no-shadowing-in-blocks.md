---
created: 2026-11-02
---
# No shadowing in blocks

Problem:

A block can still reuse an outer name: `r Integer = 2` in a branch shadows `r`, and only the type annotation shows it's a new name. A name can also be bound in a block and again later in the enclosing body: `if c { s = 1 }; s = 2`.

Rule:

Inside a block, a name from the enclosing scope always means that name. To hold a different value, use a new name, or `r = if c { 2 } else { 5 }` at the outer level.

The one exception is function params. A param can reuse an outer name, in any function notation, because it's a scoped rebinding: the name has the param's value for that function's body and the outer value everywhere else. Its best use is destructuring a param without having to alias a field whose name is already taken.

Done when:

- Binding a name from the enclosing scope is a compile error inside `if`, `else`, nested branches, `repeat while`, `catch` and function bodies, inline or assigned, whether the bind is typed or untyped. The same goes for destructuring and cell declarations in the body.
- A name bound anywhere in a body counts as an enclosing name for the blocks in it, including when it's bound after the block.
- Function params can reuse an outer name, including destructured params, on JS, Rust and Erlang. Tests show the param's value inside the function and the outer value after it.
- Inside the function, a param follows the normal rules: the body can rebind it at its own level (`x = x + 1`), and a block nested in that body can't bind its name.
- Also still allowed: rebinding in the same scope (`x = 1; x = x + 1`) and the same name in separate branches.
- The error suggests a new name.
- Tests are updated. A trial of this rule also hit older scripts in values/locals, functions/implicit_return, functions/return and functions/recursion. Check each one, and if it shows the rule is too broad, raise that rather than rewriting the test to fit. A guard that always returns, followed by a bind of the same name, is the shape to look for.
- notes/ssa-immutability-2026-04-09.md and notes/session-2026-11-02-branch-scope.md state the final rule.
