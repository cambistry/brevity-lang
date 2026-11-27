---
created: 2026-11-27
---
# Prefer v = *Type()

Prefer over v *Type = Type() 

Ticket should update to this usage throughout the test suite appropriately.

**Scope (2026-11-27):** `v = *T(…)` is `v *T = T(…)`: the parser gives the sugar its declared type,
so it takes the same checks. 16 uses in 7 test files. A cell declared with a type other than the one
it's built with (`c *T = U(…)`) can't be written in the short form, and stays as it is.
