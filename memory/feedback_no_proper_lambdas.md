---
name: feedback-no-proper-lambdas
description: "Brevity has no true lambdas; \"lambda\" forms are functions in lambda notation, closures that capture self"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 10492524-727a-410b-9e5e-a1bcafdfcd07
  modified: 2026-10-31T22:17:57.364Z
---

Brevity doesn't have proper lambdas. What older notes call lambdas are functions written in lambda notation (for now), and a function is a closure that captures the `self` context.

**Why:** the user corrected a design argument of mine that treated a "lambda" as having no receiver and no name to carry a suffix.

**How to apply:** don't design special cases for "lambdas". Rules for functions (`!` suffix, fall-through returning self) apply to them too; only inline anonymous functions lack a name.
