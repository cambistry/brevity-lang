---
name: capitalization-is-convention
description: "Brevity identifier capitalization is pure convention — never cite it as a syntactic/semantic signal (e.g. \"capitalized name marks a class\")"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 806faf10-7254-4db3-96db-44921e4bf431
  modified: 2026-11-19T17:13:45.131Z
---

Capitalization of names in Brevity is pure convention. It carries no syntactic or semantic weight, so never lean on it to disambiguate forms or as evidence that a construct is "marked" (e.g. "a capitalized name signals a lineal class").

**Why:** I argued a quiet lineal class opener was OK because "a capitalized name" marks a class; user objected strongly (2026-10-28) — the grammar must stand on tokens and LF structure alone.

**How to apply:** When judging whether a form is distinguishable/loud enough, count only real syntax (tokens, LF structure, terminators, body contents the parser sees). Related: [[feedback_brevity_check_existing_forms]].

**Scope (clarified 2026-11-19):** this is about *capitalization* not carrying meaning. It is NOT an agreed principle that syntax may never depend on scope/types — the user never stated that, and the language already resolves some forms by scope (`key: X` is a type or a local by what's in scope, `resolveLoneNames`). Don't cite "grammar can't consult types" as a rule.
