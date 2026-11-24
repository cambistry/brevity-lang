---
status: done
created: 2026-11-18
---
# `use` in inner scopes, lexically bound

Design: notes/use-di-2026-11-17.md, notes/use-as-binding-2026-11-18.md Depends on: inline `use("source")` (done); dependencies addressed by their source

Summary

Allow the `use` statement in any inner lexical scope: nested `actor { }`, class bodies, function bodies, conditional branches, loop bodies, any block. The entry is still hoisted into the file's manifest; only the binding is scoped.

Semantics

- Manifest: every inner `use` entry joins the file's manifest, deduped by source with top-level statements and `use("…")`. The host binds it at load, regardless of control flow: a `use` in a branch that never runs is still granted. An inner `use` requests nothing at runtime.
- Hoisted within its scope: an inner `use` binds its whole scope, as a top-level `use` binds the whole file, so a name is visible above the line that declares it. (An inline `use("…")` binding follows text order, like any `=`.)
- Visibility: the name is visible in the scope where `use` is written and in scopes lexically inside it. A `use` in one branch of a conditional isn't visible in the other branch or after the conditional.
- Shadowing: an inner `use` name shadows any binding of the same name in an outer scope (a local, a param, or an outer `use`). Inside that scope the name always refers to the host dependency. A shadowed reference to the same source has the same address.
- One scope, one binding per name: a `use` name next to a local, param or other binding of the same name in the same scope is an error, and so is assigning to it (`HTML = 5`, `HTML <- 5`). The same `use` binding twice in a scope is one binding.
- One connection: the same source used in several scopes is one manifest entry and one address. Placement doesn't affect `from`: a call's `from` depends on where the call is made, not where the `use` is written.
- Every statement form is allowed: shorthands (`use HTML, HTML::div`), bindings, destructures, `as` claims.
- A typed value (`use n Integer = limit`) binds the file's load-time value `limit` under a name scoped to its block; the manifest entry is the file's, shared with a top-level `use limit Integer = limit`. Two different types for one source anywhere in the file are an error.

Approach

An entry keeps its real name; a scoping mechanism, not a synthetic name, keeps that name out of other scopes. Since dependencies are addressed by source, an entry's internal key never reaches the wire. Retire the hidden `__use_*` entry names that `use("…")` introduced; key entries by source.

Work

- Parser: lift "'use' in inner scopes is not supported yet" (actor and class bodies, function bodies, blocks). Keep "'use' in a factory file is not supported yet".
- Hoist inner entries into the manifest, including those in conditional and loop bodies; dedupe against top-level entries and `use("…")`.
- Scope resolution: bind inner `use` names over their whole declaring scope (a class body or nested actor: the class, and classes nested in it); shadow outer bindings. A nested scope that rebinds a name wins inside it (the same fix applies to `use("…")`). Keep the "'x' is unknown here" error for a use outside the scope; add the same-scope conflict and assignment errors.
- Codegen for all three targets: inner scopes reach the shared manifest binding.
- The five "not supported yet" cases in __tests__/syntax/use.test.js become positive tests.
- Docs: USAGE, LANGUAGE_OVERVIEW, SYNTAX_CRIB; the notes (inner scopes decided).

Tests

- A `use` in a nested actor: visible inside, unknown outside.
- A function-body `use`, called above the line that declares it.
- A nested scope sees an outer scope's `use`.
- A `use` in one conditional branch: unknown in the other branch and after the conditional.
- A `use` in a branch that doesn't run still appears in the manifest.
- A `use` in a loop body.
- An inner `use` shadowing an outer local still gets the host value.
- An inner `use` shadowing an outer `use` of a different source under the same name: each scope reaches its own source.
- The same source at top level and inside: one manifest entry, one address.
- A `use` name and a local of the same name in one scope: error. Assigning to a `use` name: error.
- An inner typed value: bound in its scope, one manifest entry with the top-level one; conflicting types are an error.
- Runtime on js, rust and erlang: calls through an inner binding reach the dependency in a function body, a class body, a nested actor and a branch.
