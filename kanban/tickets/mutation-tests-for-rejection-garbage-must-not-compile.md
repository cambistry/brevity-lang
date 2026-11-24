---
status: done
created: 2026-11-19
---
# Mutation tests for rejection — garbage must not compile silently

Problem

Rejection was tested input by input: each known bad spelling had its own test and tailored message. That proved only that the inputs someone thought of were rejected. Generic accept-anything paths (lexer skipping unknown characters, statements needing no separator, reply fields juxtaposed) passed every test.

Proposal

A test that takes valid Brevity programs from the existing suite and applies small random token-level mutations:

- delete a token
- duplicate a token
- swap two adjacent tokens
- insert a stray token (a sigil, an operator, `:`, `|`, `**`, a name) For each mutant, assert one of:
- compilation fails, or
- it compiles to an AST equal to the original's (the mutation was neutral, e.g. a duplicated NEWLINE).
A mutant that compiles to a different AST is reported with the original, the mutation, and both ASTs, for triage: either it is genuinely valid (record it as an accepted equivalence) or the parser accepted garbage (bug).

Details

- Seeded and reproducible; print the seed on failure.
- Bounded: N programs × M mutations per run in CI; a larger opt-in sweep.
- Corpus: template literals in __tests__ that compile cleanly today (the scratch scripts in this session already extract them).
- Mutate tokens, not characters, so mutants stay near the grammar.

Acceptance

- The test runs in the js project and is green.
- Every "compiled to a different AST" case found on the first sweep is either fixed in the parser or recorded as a deliberate equivalence, with a reason.
- Reintroducing any of this session's fixed skips makes it fail.
