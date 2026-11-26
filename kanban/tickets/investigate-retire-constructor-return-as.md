---
status: queued
created: 2026-11-23
---
# Retire constructor return-as

Design: notes/constructor-return-as-retired-2026-11-23.md

A constructor block's result is always its actor. `return expr` / `-> expr` with anything but `self` or `()` at a constructor's tail becomes an error, and `self as` is the only way to project.

Find and report (no changes yet):

- Everything that reads the declaration return: the AST's `declarationReturn`, the parser's constructor-tail branch (src/parser.js, "Declaration return"), and the consumers in singleton_classes, super_calls, type_paths, base_layers, actor_values, names, and Rust codegen (program.js `genRustDispatch` and the `declarationReturn.typeName` path). Check the JS and Erlang equivalents too.
- What "superclass ingest" uses the declaration return for, and whether any current feature still needs it once the source form is gone.
- Every test and doc that writes `return <expr>` or `-> <expr>` at a constructor tail. Classify each by what it means: a projection (move to `self as`), a live element (move to a function returning it), or something else (flag it).
- Whether `self as HTML::div = -> <div>{ text }</div>` works today on every target, as the replacement for the TextDiv case.

Output: the list of sites with a proposed treatment for each, plus anything that doesn't fit the note.

**Output (2026-11-26):** file the findings as a new ticket in `inbox`, then this one is done.
