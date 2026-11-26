---
status: inbox
created: 2026-11-25
---
# Make `kanban/speculative/board.bv` compile and run

`kanban/speculative/board.bv` is the kanban board (`kanban/board.mjs`) written in Brevity as intended. Use it as a development target: a real program, about 630 lines, that exercises most of the language at once. Done when it compiles and runs as the board, with the same behaviour as `board.mjs`, and moves to `kanban/` beside or in place of it.

It depends on these tickets landing (and on the design notes they point to):

- Syntax: `constructor-star-leads`, `return-types-in-the-function-header`, `clause-lists-follow-up-pipe-into-a-list-of-functions`, `parens-around-if-conditions`, `boolean-operators-and-unary-minus`, `line-breaks-separate-items-in-multi-line-brackets`, `investigate-nullable-type-suffix`, `retire-list-of-integers-and-such-feels-out-of-step-with-the`, `switch-subscribe-to-keyword-form-sub-subject-args-value`.
- Lineal bodies closed by `end#name` on functions and constructors (`notes/lineal-definitions-2026-11-25.md`, a concept).
- Collections: `filter-find-map-sum-in-the-shape-of-over`, `list-concat-and-list-sort`.
- Types and inference: `lambda-params-take-their-types-from-the-slot`, `an-unannotated-bind-infers-only-literals-and-own-calls`, `destructure-a-core-type-s-functions`, `a-type-declaration-carries-a-namespace-of-functions`.
- Host: `files-as-addressed-values-dir-and-file`, `dogfood-the-kanban-board-in-brevity` (a Node host for terminal, process, clock and git).
- Bugs it hit while still compilable: `a-private-zero-arity-function-computing-from-a-cell-is-not-defined`, `a-private-silent-function-that-writes-is-not-defined-at-its-calls`, `a-call-on-an-actor-typed-cell-leaks-an-internal-name`, `parse-errors-carry-no-position`.

Still under discussion, so the file may change: dropping `*` on remote construction (`*Git(:dir)`), the dot-chain question (`investigate-dot-chains-on-a-cell-derive-a-live-cell`), and idempotence (`!!`).

While the language moves, keep the file current with each decision (its README says so); a form here that no ticket covers is a gap to file.
