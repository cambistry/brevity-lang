---
status: inbox
created: 2026-11-02
---
# Unannotated call arithmetic in a return differs between targets

  Problem: return r: g(1) + 10, where g holds a function, is refused at compile time on JS ("Reply/return field 'r: ...' requires a type annotation") but 

  returned 12 on Erlang. Rust didn't compile it before the fix for calls through function values in arithmetic, and hasn't been re-run since. The JS check 

  is in src/codegen/javascript/types.js, so it only applies to that target. It also has a positional form, "Reply/return expression requires a type 

  annotation", which wasn't tried on the other targets. v Integer = g(1) + 10 gives 12 on all three.

‌

  Done when:

- It's decided whether an unannotated return expression with an unknown type is allowed or is a compile error.

- The rule applies the same way on all three targets, for named and positional returns. If it stays a compile error, the check moves into shared 

  validation.

- If it stays a compile error, the annotated form the error message suggests is confirmed to work on all three targets.

- Tests cover named and positional returns.

‌

  If it stays an error, the suggested r: expr : Type needs checking: my one attempt at an annotated form, with parentheses around the expression, failed on

  all three targets, and I didn't try the exact form in the message.
