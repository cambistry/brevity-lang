# Opre addresses: colon as the token separator — 2026-11-14

Proposal, undecided, not implemented. Would revise the token rules of
`opre-addresses-as-tokens-2026-11-11.md` and the self/relative head of
`at-sigil-internal-and-quoted-names-2026-11-12.md`. Came up from `trace` (see
`from-names-calling-scope-2026-11-14.md`): a DOM attribute holding a list of addresses wants
addresses without spaces.

## The rules

| | Today | Proposed |
|---|---|---|
| Separator | space | `:` |
| Self / relative head | whole token `.` (`. template`) | leading `:` (`:template`) |
| Self alone | `.` | `:` |
| Quoted | tokens containing a space | tokens containing a colon |
| Quote inside quotes | `''` | `''` |
| Quotes when not required | invalid | invalid |

The quoting rule is today's, moved from space to colon. Spaces become ordinary token characters.

```js
{ op: '$new', to: 'HTML:div', from: ':template' }
{ re: '#<HTML:div:123>', ty: 'HTML:div' }
{ op: [['#<:template>'], '$set'], to: 'HTML:div:123:__creator__' }
{ op: '$get', to: ':~val' }                 // protected cell, relative
{ re: '#<:>', ty: 'svc.bv:Box' }            // self-return; a type tag through a file
{ op: 'go', to: "'bluster://n1':inbox" }    // a token with a colon is quoted
```

## Why

- **Colons are rare in names.** Brevity identifiers can't contain one (colon is the type
  annotation), so program names never need quoting. File names almost never do: colons are
  invalid on Windows and historically on macOS. Spaces in file names are common, and today they
  need quoting.
- **Addresses lose their spaces,** so they sit in space-separated lists unchanged: logs, shell
  arguments, and DOM attributes such as `trace="main:template main:component"`, matched with CSS
  `~=`. (Tailwind's `hover:bg-red` makes colons inside class names familiar.)
- **It reads as a qualified name,** like XML's `xlink:href`: a name within its container.
- **The relative head gets shorter:** `:template` for `. template`, `#<:>` for `#<.>`.

## What it avoids

- **No escaping ambiguity.** Doubling the separator (`::` for a literal colon) was considered and
  rejected: `a:::b` reads as either `a:` + `b` or `a` + `:b`. Quotes enclose the token, so
  `'a:b':c` is unambiguous, as `'a b' c` is today.
- **No `::` on the wire.** An empty token is invalid, so `::` never appears, and source
  `Svc::Point` (a type reached through an actor) can't be read as a wire address.

## Costs and open points

- **Spaces in tokens move the list problem rather than removing it.** A file name with a space,
  `My Notes.bv:template`, breaks a space-separated `trace`. It matters if file paths appear in
  absolute addresses rather than aliases (`main`); `ty` tags already carry paths (`svc.bv Point`
  today). `trace` may need its own rule for such entries.
- **URIs and ports would need quoting** (`'bluster://n1'`, `'host:8080'`). Free today. Whether
  absolute addresses ever carry them is a Bluster / topology question.
- **The leading colon looks like the source destructure shorthand:** `:div` in `HTML: (:div)`
  means "the `div` entry"; on the wire `:div` would mean "my `div`". Different layers, same text.
- **Scope of change:** it's Opre, not Brevity, so other CAM clients are affected. In this repo:
  every address in the three targets' codegen and runtimes, the routers, the wire expectations in
  the tests, and the 2026-11-11 / 2026-11-12 notes.

## A source shorthand: `HTML:div`

With colon-separated addresses, the header `HTML: (:div)` lines up with the wire address its
element factory has, `HTML:div`. That suggests `HTML:div` as a header shorthand for
`HTML: (:div)`: the entry would spell the address it binds.

The obstacle: the header already reads `HTML:div` as `HTML: div`, which binds the whole of `HTML`
under the name `div`. Spacing is insignificant there; checked 2026-11-14 with the JS compiler, the
tight form fails with "'div' (bound as 'div') has no type". So the shorthand would need either:

- **a lexical rule:** a colon with no space on either side forms one address token, so `HTML:div`
  and `HTML: div` mean different things, a single space apart. A trap, and the grammar otherwise
  stands on tokens and line structure, not on spacing inside a line; or
- **a different alias form,** freeing `Name: Name` in the header for the address reading.

Bodies are different: a typed local takes no colon (`count Integer = 1`), and both
`count: Integer = 1` and `count:Integer = 1` are rejected today, with different errors (checked
2026-11-14). A tight-colon address literal in a body isn't blocked by an existing meaning, though
the spaced and tight forms would still need telling apart.

Several names from one service (`HTML: (:div, :p)`) would stay as they are; `HTML:div:p` would
read as a path, `p` inside `div`.
