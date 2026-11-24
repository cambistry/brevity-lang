---
status: inbox
created: 2026-10-29
---
# Declared read-only public fields (@name = expr)

**Problem**

‌

  A class has no way to publish a read-only value computed from an expression, such as a constructor param. The public

  member forms today:

‌

  ┌──────────────────────┬──────────────────────────────────────────────────────────────────────┬─────────────────┐

  │     Declaration      │                                Result                                │  Service doc    │

  │                      │                                                                      │      shows      │

  ├──────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────┤

  │ \@n \*Integer = 0      │ public ref cell, getter and setter                                   │ n \*Integer      │

  ├──────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────┤

  │ \@p *Point = Point(1, │ public ref cell, getter only (setters are synthesized only for base  │ p () -> (Point) │

  │  2)                  │ types and Self)                                                      │                 │

  ├──────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────┤

  │ \@k = 5               │ public constant: literal or constructor call only                    │ k () ->         │

  │                      │                                                                      │ (Integer)       │

  ├──────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────┤

  │ \@title = label       │ error: "'@title' is public — only functions can be public"           │ —               │

  ├──────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────┤

  │ \@title Text = label  │ parse error                                                          │ —               │

  └──────────────────────┴──────────────────────────────────────────────────────────────────────┴─────────────────┘

‌

  Gaps:

1. No read-only public field of a base type: \@n *Integer is always writable.

1. No public field initialized from an arbitrary expression (@title = label is rejected).

1. Read-only members appear in the service doc as zero-arg methods (k () -> (Integer)) instead of the read-only

     field notation k Integer that the doc grammar already supports (total Integer = read-only field).

‌

  This blocks removing auto-accessors (a separate decision): the explicit replacement for a param's accessor is

  currently a full handler (@label = { label }).

‌

  **Proposal**

‌

  \@name = expr in a constructor block declares a read-only public field. The value is evaluated at construction, and a

  read replies with the value positionally.

‌

  C = (label: Text) *{

    \@title = label                 // read-only public field

    \@n *Integer = 0                // unchanged: readable and settable

  }

‌

- The service doc lists it as title Text.

- c.title() (and a bare c.title, if field reads are supported) binds positionally: t Text = c.title().

- c.title <- "x" is a compile error: "'title' is read-only".

- .subscribe works like on any read-only field. Whether the value can ever change after construction (it can't,

    unless expr reads a cell) needs a decision: snapshot at construction, or a live derived field?

- Subsumes the current public-constant form \@k = 5, which becomes the same thing and should be listed as k Integer.

- Decide whether the getter-only \@p *Point keeps its current shape or is listed as p Point.

‌

  **Open questions**

- Optional type annotation: \@title Text = label? Field-style declarations elsewhere use name Type. Consider allowing

    it for coercion or documentation.

- Snapshot vs live (above). Snapshot is simplest. Live overlaps the reactive-value-cell direction in

    notes/capability-sigils-2026-05-16.md.

- Parsing ambiguity: \@name = <expr> vs a handler body. Today the parser speculatively treats a literal or

    constructor after = as a constant and falls through to handler parsing otherwise. Handlers already require ->, {

    or (params), so a bare expression after = can unambiguously be a field.

‌

  **Acceptance**

- \@title = label compiles on js, rust and erlang. The read binds positionally, a set is rejected at compile time,

    and the service doc lists title Text.

- \@k = 5 is listed as k Integer.

- Tests: read, rejected set, subscribe, service-doc extraction, round-trip through parseInterface.
