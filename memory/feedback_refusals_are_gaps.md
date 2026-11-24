---
name: feedback-refusals-are-gaps
description: "A compile-time refusal in the transpiler is often an unimplemented gap, not a language rule; check before designing exemptions around it, and assume the runtime plumbing may already exist"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5f17f692-d42c-4988-a678-7d71b6743a0a
  modified: 2026-11-14T03:12:26.775Z
---

Before treating a refusal (e.g. "a class can't write/call an enclosing actor") as a design rule, check its source comment and notes. Often it says "isn't supported yet" and the runtime path already exists.

**Why:** 2026-11-13. A ticket asked whether a nested-class instance may write to its own class "as an exemption to the nested-actor rule". The user answered: "I don't think the rule differs. A nested closure can send messages to a cell in a containing scope. How is this different?" The refusal turned out to be a gap. The user also said I was giving the existing support too little credit: the `$get` chain, inside-origin `$set` arms and file-actor forwarding were already there, and lifting the guards took modest backend work.

**How to apply:** frame such questions by the language's uniform semantics (closures/classes both message their enclosing scope; see [[feedback_no_proper_lambdas]]). Estimate scope from the existing runtime plumbing, not from the guard. Prefer folding the gap fix into the feature when the user sees it as integral.
