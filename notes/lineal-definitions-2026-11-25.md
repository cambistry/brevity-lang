# Lineal definitions: one header shape, a labelled closer — 2026-11-25

Concept, a potential direction; not decided or implemented. Came out of trying layouts in
`kanban/board.bv`. Would revise the lineal constructor header (`*`, params one per line, `*`) from
`session-2026-10-28-lineal-constructor-stars.md`, kept unchanged in
`constructor-star-prefix-2026-11-25.md`. Builds on `end#label` from
`lineal-termination-implicit-return-2026-10-26.md` and the line-break separators in
multi-line brackets.

## The idea

Every definition has the same two independent choices:

- **Params:** on one line, `(a Integer, b Text)`, or one per line inside the parens. A
  constructor adds the leading `*`: `*(…)`.
- **Body:** braced, `{ … }`, or lineal, running to `end#name`.

Size picks the form. Short definitions stay braced; a long one takes the lineal body so its
closer names what it closes. In a 180-line class, `end#BoardView` pairs with its header the way a
closing tag does; a `}` that far down says nothing.

```brevity
fit = (
    text Text
    width Integer
  ) {
  …
}

parse = (
    slug Text
    path Text
    text Text
  )
  front = before(text, "\n---")
  …
end#parse

Tickets = *(dir Text)
  all *List[Ticket] = []
  …
end#Tickets

BoardView = View ^
  *(
    board Board
    tickets Tickets
    sync Sync
  )
  super(board)
  …
end#BoardView
```

## Rules

- **The label must equal the binding name.** `end#Board` closing `Column` is a compile error.
- **A lineal body requires the label.** There is no bare `end` (or `.`) for these bodies.
- **Labels nest.** A lineal method inside a lineal class closes with its own label, then the
  class's. Labels fix the nesting problem that bare `.`/`end` closers had.
- **Params one per line use the line-break separator** of multi-line brackets; no separate
  lineal param grammar.
- **A trailing operator continues the line,** so `BoardView = View ^` followed by `*(` on the next
  line is one header.

## How a lineal body is recognised

After the params' `)`:

- `{` begins a braced body.
- **A constructor** (`*(…)`) followed by a line break has a lineal body: the `*` already marks the
  definition.
- **A function** (`name = (…)` followed by a line break) has a lineal body exactly when a matching
  `end#name` closes it later in the same scope. Without that, `f = (a, b)` on its own line is an
  Object, the arguments-and-replies data shape. The check is a forward scan for one exact token
  (the lexer already reads `end#name` as one token), not open-ended lookahead.

Typed params (`slug Text`) can't begin an expression, so they already mark a header; the label
rule is what carries untyped params.

**Failure mode:** a missing or misspelled label turns an untyped header back into an Object. That
is not silent: `(a, b)` needs `a` and `b` to exist, so the header fails to resolve, or a stray
`end#prase` has nothing to close. The error should name the likely cause ("did you mean a lineal
function? `end#f` is missing or misspelled").

## Lineal constructor header

This would replace `*`, params one per line, `*`. That header exists only to mark where lineal
params start and stop, which `*(` … `)` does with the same brackets as the braced form. The two
forms then differ only in their body, and the star still leads.

## Open questions

- **A blank line after `)`.** The `)` alone on its line is the only separator between header
  and body; a blank line would echo the blank-line separation of lineal members.
- **Return types.** `) : Text {` works for the braced body; the lineal body would take
  `) : Text` on its own line.
- **The file header.** `( deps ) [->] *{ body }` and the lineal `**` header: does the file
  follow the same shape?
- **Lineal singletons** (`C = **`, members to the first blank line): fold in, or keep?
