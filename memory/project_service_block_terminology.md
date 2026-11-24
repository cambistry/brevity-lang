---
name: Service block terminology
description: The trailing block of a Brevity constructor is called the "service block" (not init/declarations/body)
type: project
originSessionId: 99a43f7e-e416-43cc-a66a-87887e357b92
---
The code following a constructor's `<...>` header is the **service block**. Applies to both forms:

```
<header> -> { service block }

<
  header
>
=
service block
```

**Why:** The interface grammar `<header> -> { interface }` already establishes that a constructor produces a service. The trailing block is what *defines* that service (handlers, state, lifecycle). Previous names were wrong: "init block" — init happens in the angle brackets, not after; "declaration block" / "declarations" — too generic; "constructor body" — structural, not semantic. Decision made 2026-04-16.

**How to apply:**
- Use "service block" when discussing this concept in new notes, code comments, test docs, and user-facing explanations.
- The rename pass across prose/docs/comments completed 2026-04-16 (see `notes/service-block-terminology-2026-04-16.md`).
- **AST field names (`initBody`, `constructorBody`) stay as-is permanently.** The AST has its own `<scope>Body` naming convention (matching `functionNode(params, body)`, `onHandler(..., body)`, etc.) — these are structural role names for parser/codegen, a separate vocabulary from the user-facing semantic concept. Do not attempt to rename them.
- Static services (no trailing block) are possible — angle brackets alone can produce an immutable type/service. The service block is what makes a service *live* (stateful, dynamic handlers).
