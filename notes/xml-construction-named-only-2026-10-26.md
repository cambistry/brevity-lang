# XML-form construction is named-only — 2026-10-26

Status: **decided** (design). Settles the positional-argument question left
open by `xml-construction-syntax-2026-05-03.md` (open questions #2, #9) and
`bvx-conclusions.md`.

## Decision

Angle-bracket construction is defined as **named k-v attributes only**:

- a class/type name,
- named attributes — `name="str"` or `name={expr}`,
- bare-flag shorthand — `<User admin>` ≡ `admin=true`,
- children — `<X>...</X>`.

**No positional arguments inside `<>`.** `<Pair 3 4>` is dropped. Not even the
single-value literal (`<Integer 0>`) — see "one exception, also dropped."

Positional construction keeps its existing home: `Type(...)`. `Pair(3, 4)`,
`Integer(0)`, etc. are unchanged.

## Why

The whole-language call, not a local syntax nicety.

1. **The closed definition is the prize.** "XML-form = name + named attrs +
   bare flags + children" makes angle-bracket form *exactly* XML — closed
   grammar, one-sentence rule, and the one-way-subset guarantee
   (`xml-construction-syntax-2026-05-03.md`) holds in its strongest form:
   paste any well-formed HTML, it parses. Admitting `<Pair 3 4>` turns
   XML-form into a lookalike grammar that merely coincides with XML
   sometimes — crisp identity traded for a cute case.

2. **Positional is the sole source of the ambiguity class.** Bare-flag
   collision, whitespace-vs-unquoted-expression, and keyword-prefix
   (`from`/`to`/`of`) collision — all three exist *only* because of
   positional. Remove it and they evaporate: named k-v is self-delimiting,
   `={expr}` swallows arbitrary expressions, and `<Foo bar>` is
   unambiguously a flag because nothing competes for the positional reading.
   A whole disambiguation class leaves the parser and the mental model at
   once.

3. **Positional already has a good home: `()`.** `<Pair 3 4>` is a second way
   to do what `Pair(3, 4)` already does well, and it is the one reading of
   `<>` that carries *none* of the prepositional/DOM/children benefit that
   justifies the angle-bracket form existing. The 05-03 smoke test already
   found named (`<Pair a=3 b=4>`) notably ahead of positional for 2+ args —
   positional loses even on aesthetics within its own family.

4. **Principled split, not arbitrary.** The arg/reply primitive is the Object
   (positional + named entries; see [[vocabulary-refactor-2026-05-15]]).
   `()` is the surface that fills *both* lanes; `<>` is the surface
   specialized to the *named* lane, with XML affordances (children, bare
   flags, HTML-paste) layered on. `<>` is a deliberate restriction of `()`,
   not a redundant twin — and that restriction is what buys the cleanliness.

## One exception, also dropped

The single-value literal (`<Integer 0>`, `<Text "x">`) is ambiguity-safe in
isolation — one positional has no "where does arg N end" problem. Dropped
anyway:

- `Integer(0)` and the bare literal `0` / `{0}` already cover every site.
- Admitting "exactly one positional" reopens the flag-vs-value question for
  the 1-arg case and costs the one-sentence rule.

`<>` stays purely named; `()` carries everything positional.

## Implementation bearing

Aligns with where the transpiler already is. Per
[[type-named-construction-gap-2026-10-25]]:

- XML construction already **lowers to named args**, so there is no XML-side
  change — the gap note's fix (extend the named-binding path to cover
  required-only Types) is the whole job, and it lands XML construction for
  all shapes with no positional path to add.
- Positional-param classes are already rejected from XML construction
  (`validate.js:1517`); this decision makes that rejection *intended and
  permanent*, not a stopgap.
- Attribute values are already `="str"` / `={expr}`, bare `x=1` rejected — no
  change.

## Knock-on

- The 05-03 "argument forms" table loses its Positional and Mixed rows for
  `<>`. Keyword-prefix (`<Range from 0 to 100>`) stays — it is named
  attributes with `=` elided, not positional.
- 05-03 open question #2 (whitespace vs. comma separator) is moot — no
  positional separator to choose.
- 05-03 open question #9 (bare-flag semantics) simplifies: bare flag is
  unambiguous once positional is gone; remaining sub-question is only
  type-driven (must be Boolean) vs. universal (`=true` always).
