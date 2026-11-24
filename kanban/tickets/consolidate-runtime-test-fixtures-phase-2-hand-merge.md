---
status: inbox
created: 2026-11-17
---
# Consolidate runtime test fixtures — phase 2 (hand-merge remaining files)

  Background

  Each distinct runtime source a test file compiles is one Rust build (~50–85 s each).

  Target: one script per describe, and only 1–2 runtime describes per file (3 at most).

  Compile-only tests (compileSource / extract) stay one source per case.

  Phase 1 cut files over the limit from 73 to 39. That work merged scripts that could be merged

  mechanically, inlined local step builders into literal input/output steps, and fixed three

  compiler bugs the merges exposed:

- outer_reads: an inherited function was rejected as another class's name

- effects: an untracked \@x cell made writes to a different bare x cell count as untracked

- param_scope: a param named like a ref cell was read as the cell

‌

  Scope (phase 2)

1. Verify phase 1 on Rust. 20 merged files have only been run on JS: void_return,

     type\_inference, type\_matching, locals, ingest, return\_actor\_call, core_types/text,

     conditional\_return\_in\_while, public\_params, silent, single_expression, catch, xml/tags,

     if, lineal\_form, cam\_test/op, functions/subscribe, bang, protected\_labels, type\_coercion.

‌

1. Hand-merge the remaining files over the limit, grouped by what blocks a mechanical merge:

     a. Protocol-sequence tests. Merging shifts message ids and top-level construction

        emissions: dependency\_injection, cam/interop, remote\_call\_binds, named\_returns,

        marshal/hydrate, marshal/capture\_hydrate, closure\_subscribe_interop, keywords/subscribe,

        cam\_test/set, cam\_test/update.

        Approach: prefer constructing inside handlers where the test isn't about construction

        at file init, and give each test its own dependency alias or path.

     b. The same dependency path declared with different interfaces in different sections:

        remote\_instance, constructor\_block, cross\_module\_ref_fields.

        Approach: give each section its own path or alias, and check the wire \`to:\` still

        means the same thing.

     c. Tests where a merge would change what they check: members_table (asserts the whole

        members table), marshal/capture (captures the whole state), outer_reads (\`total\`

        reused with different initial values and as a reply key).

        Approach: a fixture per describe, but fewer describes; or decide these are accepted

        exceptions.

     d. One inline source per test: type\_wire, public\_class, public\_class\_across_files,

        subclass\_runtime, self\_as, implicit\_return, return\_shapes, param_rename, semicolon,

        type\_dependency, type\_in\_actor, type\_optionality, file_params, destructure/params,

        keywords/emit, xml/service\_agnostic\_template, library/math.

        Approach: hoist into a describe-level script with one handler per case.

     e. Inherent exceptions to document, not merge: return_as file-level cases (a file has

        one tail return); type_coercion header vs options.remotes variants (the difference

        is the thing under test).

‌

1. Remove the remaining in-file frameworks: wrappers around createActor / expectBehavior,

     shared step arrays, and sources assembled from template pieces. Keep a helper only where

     a test has to reach into the message chain programmatically (e.g. integer's expectN,

     which converts BigInt replies with Number() for JS/Rust parity).

‌

1. Optional: add the fixture-count audit (static, per file) to tooling so new tests

     don't drift back over the limit.

‌

  Acceptance

- No non-DOM test file has more than 3 runtime fixtures, except the documented exceptions.

- Every test kept (none dropped or skipped); JS, Rust and Erlang pass for each touched file.

- Any compiler bug a merge exposes is fixed with its own regression test,

    not worked around by splitting the fixture again.
