---
name: feedback-test-style
description: "How to write Brevity runtime tests — one shared script per describe, literal expectBehavior steps, no custom assertion helpers, no per-test source compiles"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2940f4d7-1579-4bea-8bde-627dd615da21
  modified: 2026-11-21T10:53:58.751Z
---

Write runtime tests the way `__tests__/keywords/self_as.test.js` and `core_types/structure.test.js` do:

- **One script per describe, and only one or two runtime describes per file** (three in an extreme case). Each script is one Rust build, so a file with 21 describes is 21 builds; fold cases into a describe's script rather than adding describes. (2026-11-17 audit: 73 files over the limit.)
- **Use `__tests__/helpers.js`** (`expectBehavior`, `createActor`, `expectActorBehavior`, `compileActor`) directly — don't roll a mini-framework in the test file (wrappers like `run = (src) => createActor(src).then(...)`, `expectN`, step builders). Exception: tests that must reach programmatically inside the message chain.
- **Literal steps.** Each `it` calls `expectBehavior(script, { input: {...} }, { output: {...} })` (`expectActorBehavior` for a live actor), showing the messages in the test. Match the exact reply, including `bv-a`; use `expect.objectContaining` only where a field really varies, such as an outgoing send.
- **No assertion helpers.** Don't hide `expect` calls in local helpers like `ok(source, re)` or `fails(source, msg)`, so a reader can see what each test asserts.
- **No `\n`-escaped Brevity** in test source, and no `actor.posts.find(...)` when steps can express it.
- **Compile errors** are the exception: `expect(() => compileSource(...)).toThrow(...)` with its own source per case.

**Why:** the user has had to correct this repeatedly after `/clear`. Helper-wrapped tests hide what they assert, and a separate source per test means a separate compile per test, which is very slow on Rust.

**Multi-actor / wire tests too (2026-11-21):** the user flagged that across a whole ticket run I ignored this for cross-actor tests — wrappers like `ask`/`network`, asserting on `net.external` / `posts` instead of literal steps. Exercise actors over the wire with the existing helpers and show each message as a literal step.

**How to apply:** before writing or extending any test, read a neighbouring test file in the same directory and match it. Applies to tests added to existing files too. Related: [[feedback_never_drop_failing_tests]], [[feedback_no_target_guards]].
