# Test-Backed Language Notes

LLM orientation: this directory contains executable behavior tests plus compact
markdown notes for agents writing or explaining Brevity. Prefer these notes when
generating current examples.

## Current Maps

- Fast generation path: [Writing Brevity Quickly](../docs/LLM_WRITING_BREVITY.md)
  and [Syntax Crib](../docs/SYNTAX_CRIB.md).
- [CAM / Interop](cam/index.md)
- [Constructors](constructors/index.md)
- [Destructuring](destructure/index.md)
- [Functions](functions/index.md)
- [Keywords](keywords/index.md)
- [Operators](operators/index.md)
- [Services / Host API](services/index.md)
- [Types and Shapes](types/index.md)
- [Core Types](core_types/index.md)
- [Browser Target](browser/index.md)
- [CAM Test Messages](cam_test/index.md)
- [Compile API Smoke Tests](compile/index.md)
- [HTML / XML Surface](html/index.md)
- [Exceptions and Errors](exceptions/index.md)
- [Library](library/index.md)
- [Literal Type Inference](literals/index.md)
- [Marshal / Lifecycle](marshal/index.md)
- [Run Smoke Tests](run/index.md)
- [Runtime](runtime/index.md)
- [Syntax](syntax/index.md)
- [Values](values/index.md)
- [XML Surface](xml/index.md)

## LLM Rules

- Treat tests as stronger evidence than notes.
- Use current syntax from tests: `Type!`, `Name!(...)`, `#name`, `#new`,
  `::Shape`, `< ... > =` dependency headers.
- When unsure, use the simplest current pattern from the relevant directory.
- When unsure, cite the relevant `.test.js` file and keep claims narrow.

## Task Routing

- Writing actor files: [CAM / Interop](cam/index.md), [Functions](functions/index.md),
  [Values](values/index.md).
- Mutable state: [Operators](operators/index.md), [Ref Cells](operators/ref.md).
- Dependencies and remotes: [Services](services/index.md),
  [Remote Instances](cam/remote_instance.md).
- Shapes and typed values: [Types and Shapes](types/index.md),
  [Core Types](core_types/index.md).
- Text, list, and blob operations: [Core Type Methods](core_types/methods.md).
- Browser or markup output: [Browser Target](browser/index.md),
  [HTML / XML Surface](html/index.md), [XML Surface](xml/index.md).
- Runtime messages and lifecycle: [CAM Test Messages](cam_test/index.md),
  [Marshal / Lifecycle](marshal/index.md).
