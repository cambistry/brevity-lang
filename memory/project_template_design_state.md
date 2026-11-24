---
name: Template type design state (active)
description: Pointer — template/implicit-return design state lives in notes/, not private memory. Check notes/ for current direction.
type: reference
originSessionId: 43a88a5f-a155-4936-bcf7-653d41e4d22c
---
Design state for the template system and the constructor tail-return ("self becomes") mechanism lives in `notes/`, **not** in private memory. Chris prefers repo-visible design docs. When this topic comes up, the **current** model is in `notes/self-becomes-2026-04-14.md` — start there. The earlier 04-10 and 04-14-morning notes are superseded but retained for path-record.

Read order:

1. **`notes/self-becomes-2026-04-14.md` (current model, 2026-04-14 afternoon)** — the tail `->` in a constructor declares that the wrapping actor *becomes* the tail value: handle semantics, value captured at construction, boundary unwrap at call sites driven by the receiving function's signature. Explicitly **not** method inheritance — the wrapper's interface is only what it declares. Distinct from `self as` — both coexist (`self as` = on-demand projection via function; tail-return = construction-time captured value via default projection). DOM/Para as the motivating example.
2. **`notes/callable-files-2026-04-14.md` (current, 2026-04-14 afternoon)** — recursive application of tail-return at the file-constructor level. When a file's body is an inline anonymous constructor or a function literal, the file itself becomes directly callable (`Factory(content: "Hello!")` instead of `Factory.Template(...)`). Covers both cases (file-as-constructor and file-as-function), staged construction / currying-by-composition, and the retroactive explanation of the 04-10 `self as Function` direction. Experimental `<:"function.bv">` import syntax flagged as not settled.
3. **`notes/tail-return-wire-2026-04-15.md` (current, 2026-04-15 — wire-protocol proposals)** — CAM-level story for tail-return. Three distinct shapes (value-tail / constructor-tail / function-tail) with different wire implications. Proposes: extended `::new` reply with `tail-as: { type, ref }` for value-tail; `::new` generalized to target either a type or an instance-with-constructor-tail for constructor-tail; new `::call` system op for function-tail. Also flags the gating open question of import-declaration syntax for tail-return files. **Answers the "is there a CAM op for getting the whole actor?" question: no, never has been. CAM is strictly actor-addressing; tail-return adds address-level relationships, not object marshalling.** Proposals, not settled.
4. `notes/implicit-return-refinements-2026-04-14.md` (superseded morning of 04-14) — syntactic rules for the tail-return are still accurate (one return per block, `.`/`self` defeat, branch-type consistency, orthogonal to `returns`), but the "implicit `self as T`" semantic framing is wrong. Read for rules only.
5. `notes/implicit-return-is-projection-2026-04-10.md` (superseded) — the "tail-return is `self as` sugar" framing that the 04-14 reframe replaced. Historical.
6. `notes/template-type-2026-04-10.md` — the `self as Function` framing that replaced the 2026-04-09 yields-ingest plan. Read through the lens of the 04-14 reframe: the `self as Function` direction was groping toward tail-return + callable files, which `callable-files-2026-04-14.md` now realizes structurally instead of projectively.
7. `notes/actor-as-constructor-2026-04-10.md` — related; records earlier framing that the 04-10 projection note partially superseded.

The 2026-04-09 `template` supertype / `yieldsIngest` plan (`notes/template-type-2026-04-09.md`) is superseded. Do not start from it.

**TDD spec file:** `__tests__/constructors/implicit_as.test.js` was written 2026-04-14 morning under the superseded "implicit self-as" framing. It uses `self as` language throughout and needs revisiting under the "becomes" model before implementation. Several cases may be testing the wrong thing — in particular, the runtime cases that rely on narrowing (`t Text = C()`) miss the whole point of "becomes," which is that no narrowing is needed.

**Do not duplicate this content back into private memory.** If the design shifts, update the notes — this file stays as a pointer.
