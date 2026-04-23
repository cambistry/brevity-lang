# Keywords

This directory covers language keywords and built-in forms that shape control
flow, composition, and actor interaction.

These are not merely reserved words sprinkled around the syntax. In Brevity,
keywords often mark a shift in the meaning of a computation:

- from plain local evaluation to actor composition
- from direct sequencing to iteration
- from ordinary calls to event or reference semantics

That is why the topics in this directory can feel broader than a traditional
"keyword reference." Each one tends to expose something central about how
Brevity expects programs to be structured.

## Themes in this directory

### Composition and wiring

Some keywords declare relationships between actors or services:

- `uses`
- `ref`

These are about more than syntax. They tell the compiler and the reader how the
current actor is allowed to connect to other parts of the system.

### Iteration and transformation

Others describe structured data flow:

- `over`
- `reduce`
- `repeat while`
- `repeat until`

Brevity prefers these explicit forms over a large family of loosely related loop
constructs. The goal is not maximal surface area, but a smaller set of patterns
with clear meaning.

### Event and state semantics

Keywords like `emit`, `on`, `spawn`, and `ref` describe ways work can unfold
without collapsing everything into plain synchronous function calls. They help
the language stay faithful to its actor model even when expressing local
patterns like mutable cells, events, or background work.

## Documents in this directory

- [`ingest`](ingest.md)
- [`over`](over.md)
- [`reduce`](reduce.md)
- [`ref`](ref.md)
- [`self as`](self_as.md)
- [`uses`](uses.md)

More notes can be added alongside the individual test files as those features
settle.
