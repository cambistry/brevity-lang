---
created: 2026-11-25
---
# Files as addressed values: `Dir` and `File`

Design: `notes/file-views-and-codecs-2026-11-27.md`, which revises
`notes/files-as-addressed-values-2026-11-25.md`. Mocked up in `kanban/speculative/board.bv`.

```brevity
use Dir, File

type TicketMeta(status: Text?, created: Text?)
type TicketFile Markdown[TicketMeta]

tickets = Dir[TicketFile]("./tickets/*.md")
specs List[Text] = File[Lines]("./columns")

tickets[slug]::FrontMatter <! status: "review"
```

Want: the series below, in order. Each is testable without the ones after it.

Tests:
- `a-test-suffix-marks-tests-that-need-a-file-system`

View types (pure, no files):
- `a-one-field-type-declares-self-as-presentations`
- `a-cell-of-a-view-type-takes-writes-through-self-set`
- `a-named-presentation-is-reached-with-double-colon`
- `element-writes-and-merge-derive-from-a-collection-presentation`
- `design-a-view-type-passed-to-a-parameter`
- `design-generic-one-field-types`

The cell protocol:
- `a-write-needing-the-current-value-is-a-versioned-write`

Host file actors:
- `file-should-be-a-host-actor`
- `every-file-on-one-path-reaches-one-representative`
- `file-of-c-binds-a-typed-address`
- `dir-of-c-is-a-keyed-collection-of-files`

The board:
- `board-bv-s-file-parts-should-use-file-and-dir-views`

Open design, taken up when it blocks something:
- `design-an-atomic-write-of-several-presentations`
- `design-a-read-only-file-view`
- `design-positional-focus-stability-under-sub`
- `design-a-dir-as-a-view-type`
- `design-key-focuses-beyond-globs`
- `design-merge-operator-beside-bang-names`

Separate: `an-annotation-constructs-its-type-from-the-initializer`.

Done when the series is done.
