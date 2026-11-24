---
status: done
created: 2026-11-20
---
# `super` in a class-block function

Design: notes/super-2026-11-19.md ("In a class block").

- A class block that extends another always has a base, the parent's block. `super` and `super(args)` in a class-block function run the parent block's function for the extending block, late-bound. Example: A = actor { @f = { … } }; B = A ^ { @f = { super + 1 } }.
- Retire the "a class block has no parent layer" error for `super`, and for `base::` / `base.` in class blocks if they share it.
- Same arg rules, multi-parent rule and lambda rule as in instance functions. No constructor every-path rule.
- Tests on every target: public and protected; reading a cell the block redeclares vs. one it shares; multi-level.
