---
created: 2026-11-20
---
# `class::base` is the running class's parent

Design: notes/super-2026-11-19.md ("`class::base`").

- `class::base` is the running class's parent class (Ruby's self.class.superclass); in `T`'s code running for a `U`, it's `T`.
- `class::base::h` reaches the parent's class-block protected `h`; `class::base.f` its public `@f`; `class::base(…)` constructs a separate actor of the parent class.
- With more than one parent, `class::base` is an error saying to write the parent's name. `class::base[A]` is not a form.
- In a class with no parent, `class::base` is an error.
- `class.base` stays a public member `@base`.
- Tests on every target, including a no-base subclass reaching its parent's class block through `class::base`.
