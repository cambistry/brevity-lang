# Core Types

LLM orientation: this directory tests scalar and aggregate runtime behavior.
Use it for examples involving literals, lists, structures, text, numbers, null,
and built-in methods.

## Tested Areas

- `Integer`, `Decimal`, `Float`, `Text`, `Boolean`, and `null`.
- `Blob` and blob methods.
- `List` construction, validation, methods, prepending, and empty-list behavior.
- `Structure` rest binding, destructuring, indexing, and literals.
- Text interpolation and grapheme-aware text behavior.
- Type indexing and literal type inference.

## Method Guides

- [Core Type Methods](methods.md)
- [Text Methods](text_methods.md)
- [List Methods](list_methods.md)
- [Blob Methods](blob_methods.md)

## LLM Rules

- Use `List of Integers`, `List of Texts`, etc. for typed lists.
- Empty lists are tested as `[]` at source level.
- Use `Structure` for rest payloads such as `|...args Structure|`.
- Prefer explicit casts such as `as Integer` when the example needs a stable
  reply type.
- Check specific method tests before inventing method names.
