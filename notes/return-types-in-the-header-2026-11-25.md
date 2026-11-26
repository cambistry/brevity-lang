# Return types in the function header — 2026-11-25

Proposal, not implemented. Came out of `kanban/speculative/board.bv`, where an explicit `self` at
the end of every `!` function read as noise. Would supersede the rules for a `!` function body in
`mutation-suffix-2026-10-31.md` (rules 1–6: no implicit tail return, falling off returns `self`,
mixed paths), and revive, checked, the slot `return-type-inference-2026-05-06.md` dropped and kept
free ("possibly `} : Type` revived … compile-time-checked against every body return point").

## The form

A return type goes in the header, after the params, as in TypeScript:

```brevity
@create! = (title Text, status Text) : Text {
  …
  slug
}

@integrate! = () : Boolean { … }
@press! = (key Text) : View { … }
@size = () : Integer -> List.size(cards)
```

## Rules

- **A function's last value is its return, everywhere.** Implicit tail return works the same in
  every function, `!` or not.
- **A `!` function with no declared type returns `self`.** Its tail value is not returned; falling
  off the end is `self`. A bare `return` means `return self`, so early exits read
  `if (to == null) { return }`.
- **A declared type covers every path.** `: Integer` means every path produces an Integer,
  including the tail; the compiler checks each return point against it. A `!` function that
  returns anything other than itself declares it, even an actor of its own class.
- **`: self` is the only spelling of "returns its receiver".** `: BoardView` on a `BoardView`
  method means a `BoardView`, not necessarily this one.
- **Constructors take no type and no `return`.** `*(p) : T { … }` is an error.
- **Zero params need `()` to carry a type:** `@integrate! = () : Boolean { … }`. `fn! = { … }` stays
  a valid shorthand without one.

In `board.bv` this removed 26 closing `self`s. The ones left carry information: in `@press! : View`,
`self` means "stay on this view", against `back`.

## How it parses

After a param list's `)`, a `:` has no other meaning: named arguments and reply fields put the
colon before the value, destructures put it after a name, and there's no `?:`. So `) :` reliably
starts a return type. The parser already looks past the matching `)` for `{` or `->`
(`skipArrowBeforeBrace`, `isDelimitedClassStart` in `src/parser.js`); the header adds an optional
`: Type` before those.

- **The type ends at `{` or `->`.** A bare name followed by `->` is never a type (function types
  start with `(`), so `(a) : Integer -> a + 1` is unambiguous.
- **An interface type** brings its own braces: `() : *{ get () -> (Integer) } { body }` takes the
  first brace group as the type. Legal, but better with a named type.
- **A function type** is read greedily: `(a) : (Integer) -> Integer { … }`. With an arrow body,
  parens are required: `: ((Integer) -> Integer) -> expr`.
- **A structure return** with an arrow body looks like a function type
  (`: (out Text, ok Boolean) -> expr`); a parenthesized type followed by `->` is a function type,
  so a structure return takes a braced body.
- **`self`** is lowercase, so `: self` can't be mistaken for a type name; it's a keyword there.

## Open questions

- **Lineal bodies** (`lineal-definitions-2026-11-25.md`): `) : Text` on its own line before the
  body?
- **Params versus return.** Source params are `(key Text)`, the return `: View`; TypeScript uses
  the colon for both, and service documents write `(path: Text)`. Not a parsing problem.
- **Inference of undeclared returns** on non-`!` functions stays as today (literals, own calls;
  ticket `an-unannotated-bind-infers-only-literals-and-own-calls`).
