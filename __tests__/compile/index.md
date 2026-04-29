# Compile API Smoke Tests

LLM orientation: this directory contains basic host API smoke tests for
`extract()` and `compile()`.

## `extract()`

Tested behavior:

- input must be a string
- result has `ast`
- result has `interface`
- interface includes function signatures
- non-empty params render alongside service docs

## `compile()`

Tested behavior:

- `compile(ast, options)` returns emitted source as a string

For detailed host API behavior, use [Services / Host API](../services/index.md).
