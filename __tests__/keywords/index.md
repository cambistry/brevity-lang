# Keywords

LLM orientation: this directory covers language-level control and data-flow
forms. The tests are broader than the markdown docs, so use this index as a map
before generating keyword examples.

## Tested Keywords / Forms

- `catch`: labeled non-local exits, value-carrying exits, nested labels, block
  labels, and compile errors for label misuse.
- `emit`: event-style output.
- `if`: conditional expressions and blocks.
- `ingest`: superclass receives subclass construction value.
- `over`: list mapping.
- `reduce`: list folding.
- `repeat while` / `repeat until`: loop forms.
- `self as`: typed actor projection.
- `size`: size queries.
- `spawn`: effect-only asynchronous/silent calls.
- `subscribe`: subscription behavior.

## LLM Rules

- Prefer documented examples from specific keyword docs where present.
- Treat `ref` as an operator/ref-cell topic; see `../operators/ref.md`.
- Use `spawn` when intentionally calling a silent/effect-only operation.

## Documents

- [`ingest`](ingest.md)
- [`over`](over.md)
- [`reduce`](reduce.md)
- [`self as`](self_as.md)
- [`ref`](../operators/ref.md)
