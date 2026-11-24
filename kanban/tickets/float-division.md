---
status: done
created: 2026-05-07
---
# Float division

function.test.js:155 — (a, b) { a / b } with fn(3.0e0, 2.0e0) returns 1 instead of 1.5. The bv-a says Float but the value is integer-divided. This is the
operator-dispatch question I flagged earlier: Float / Float should produce Float math, but the runtime is doing integer division. Independent of the :/as question
— it's a runtime/codegen gap. Would be its own thing to fix.
