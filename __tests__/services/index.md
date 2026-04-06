# Services / Host API

The tests in this directory cover the public compiler-facing surface of
`brevity-lang`.

These are not language features in the same sense as constructors or keywords.
They are the host-side interfaces that let other tools parse, inspect, and
compile Brevity source.

## Why this matters

Brevity is not only a language you write. It is also a language that other
tools are expected to analyze and compile.

That is why the host API is intentionally small and structured around two
separate phases:

- `extract(source)` for parsing and dependency/interface discovery
- `compile(ast, options)` for validation and code generation

That separation matters because the compilation environment may need to resolve
remote manifests or dependency information before code generation can happen.

## Documents in this directory

- [`extract()`](extract.md)
