---
status: done
created: 2026-11-18
---
# Inline `use`: use("source") in value position

Summary

`use("source")` is an expression: it evaluates to the dependency the host supplies for that source. Its binding is an ordinary `=`, scoped where it's written, so inline `use` works in inner scopes (the `use` statement still doesn't). The argument is a string literal, so the source is known at compile time: every `use("…")` is hoisted into the file's manifest like a `use` statement, and the manifest stays complete.

Syntax

```
svc = use("svc.bv")                              // an actor ref
svc = use("svc.bv") as { n () -> (Integer) }     // claimed with ordinary `as`
:div = use("HTML")                               // destructure
:div, :span, p: para = use("HTML")
n Integer = use("svc.bv").n()                    // used directly
@go = {
  :div = use("HTML")                             // scoped to @go
  return div()
}
```

Semantics

- The argument is one string literal, single or double quotes. It is the whole source, taken literally (no `::` splitting inside it).
- The source resolves in the host, never in lexical scope, as with the statement.
- Hoisted: each source is one manifest entry, keyed by source. An inline `use("HTML")` and a `use HTML` statement in the same file share an entry; two `use("HTML")` share one.
- The binding is lexical. `:div = use("HTML")` in a function binds `div` in that function only. Names bound inline never reach the file's scope.
- An inline `use` has no local name of its own; it lowers to a hidden name for its manifest entry (shared per source). Codegen keeps keying dependencies by local name.
- Its shape comes from `as` on the expression, or from `options.remotes`; with neither, it's the existing "has no type" error.
- Allowed anywhere in the file actor, inner scopes included (functions, constructor blocks, nested actors and classes). The entry is the file's.

Fix: body-form DI destructures are lexical

`(:div) = HTML` in a function body is folded into the file-level dependency's destructures (src/validate.js, "Rewrite body-form DI destructures"), which makes `div` visible file-wide. It should bind in the scope where it's written. The inline form lowers to the same scoped destructure.

Errors

- A bare name: `use(HTML)` → "a 'use' source in an expression is a string: 'use("HTML")'"
- A `::` path: `use(HTML::div)` → "write ':div = use("HTML")'"
- Interpolation: `use("/svc/#{x}")` → "A 'use' source is static: it takes no interpolation"
- No argument, or more than one
- `use "svc.bv"` in value position (no parens) → "write 'use("svc.bv")'"
- In a factory [file: "'use](file: "'us "")' in a factory file is not supported yet"

Out of scope

- Making the `use` statement sugar for the inline form (the statement's `::` paths, shorthands and claims don't map one-to-one yet).
- Runtime-computed sources.
- A member reach on the result (`use("HTML")::div`).
- `use` in factory files (next ticket).
- Backtick references.

Work

- Parser: `use` followed by `(` in expression position parses a UseExpr with one string-literal argument; the errors above.
- Hoist: collect each UseExpr's source into the file's dependencies (dedupe by source, merging with statement entries); give it a hidden name.
- Lower the UseExpr to a reference to that name; a destructure of it is the scoped destructure below.
- validate.js: body-form DI destructures bind in their own scope instead of folding into the file-level dependency. Check js, rust and erlang codegen route the scoped members.
- Docs: LANGUAGE_OVERVIEW, USAGE, SYNTAX_CRIB; update notes/use-as-binding-2026-11-18.md ("`use` in value position").

Tests

- Each Syntax line compiles; the manifest has one entry per source.
- `use("HTML")` twice, and with a `use HTML` statement: one entry.
- Scope: `:div = use("HTML")` in one function; `div` in another function is an unknown name. Same for `(:div) = HTML` with HTML from a statement.
- Runtime: calls through an inline-use binding reach the dependency (js, rust, erlang), in a function body and in a constructor block.
- `as { … }` on the expression checks calls against the claimed interface.
- Each error above.
