# `use` entries are bindings — 2026-11-18

Direction, not implemented. Replaces the entry grammar of `use-di-2026-11-17.md` (the header
entries carried over from `**`: `"svc.bv": Svc`, `HTML: (:div)`). What `use` does is unchanged:
static, hoisted into the file manifest, bound by the host, lexically scoped.

## Form

A `use` entry is a declaration, a binding or destructure, with `use` in front:

```brevity
use HTML                           // shorthand for  use HTML = HTML
use HTML::div                      // shorthand for  use div = HTML::div
use d = HTML::div                  // rename
use d Div = HTML::div              // rename, typed
use :div = HTML                    // destructure, the sigil as everywhere else
use (:div, :span, p: para) = HTML
use :div, :span, p: para = HTML    // parens optional, as in any destructure
use :fn = "/path/to/actor"
use Svc = "svc.bv" as { n () -> (Integer) }
use "/service"::Widget             // shorthand for  use Widget = "/service"::Widget
use "/service" as { send! () => self }   // binds nothing: types and declares the address
```

- **Binding and destructure grammar, unchanged.** The left side is what it is in any
  declaration: a name, a name and type (`d Div`), or a destructure (`:div`, `(:div, :span)`). So
  `use :div = HTML` is the same destructure as `:value Text = DB.lookup(:key)`, and it teaches the
  same sigil.
- **Several names are a destructure.** `use :div, :span, :p = HTML`, with or without parens, a
  rename as `p: para`. There is no `::` group form. Bare names (`use div, span = HTML`) would
  destructure by position, as `a, b = args` does.
- **More than one spelling binds the same thing.** `use HTML::div`, `use div = HTML::div` and
  `use :div = HTML` are equivalent, like member access and destructure in ordinary code. Which to
  write is up to the programmer, or a linter.
- **The shorthand is the one entry with no `=`.** A lone source binds its trailing segment:
  `use HTML` is `use HTML = HTML`, `use HTML::div` is `use div = HTML::div`, and
  `use "/service"::Widget` is `use Widget = "/service"::Widget`. When the source is a single
  quoted segment (`use "/service"`), the entry binds nothing: see "Backticks" below.
- **A value is a dependency like any other.** The `**` header's load-time params (`limit:
  Integer`, a plain value the host passes in) need no form of their own. Every `use` source is a
  name the parent resolves, whether it names an actor or a value, so `use limit` is the compact
  form, as `use HTML` is. Its type comes from the interface. Written out, it's
  `use limit = limit`, or typed, `use limit Integer = limit`. The current `use :limit Integer`
  goes.
- **The right side resolves in the host.** This is the one way `use x = y` differs from `x = y`:
  `y` is a name in the host's namespace, never one in lexical scope ("always the host").
- **`::` reaches a nested name.** `HTML::div` isn't a call. It names `div` inside `HTML`, as
  `Svc::Point` names a type and `C::name` a protected class member. So `::` reaches any name
  declared in an actor, not only types and protected members.
- **`as` is coercion, here as everywhere.** No rule is special to `use`: renaming is the left
  side of the binding, and `as` on the source claims its shape. An inline interface, `#`, and a
  constructor profile become ordinary coercions on the source, so the entry grammar comes down to
  `target [Type] = source [as Shape]`.

## Why not a postfix rename

`use HTML::div: div2` is ugly. `use HTML::div as d` would put two meanings on `as`: rename in
`use`, coercion everywhere else. Capitalization isn't syntax, so in `use Shapes::Box as Crate`
nothing says whether `Crate` is a local name or a type. And a dependency is exactly where you
want to coerce ("treat what the host gives me as this"), so making `use` never coerce would be
an arbitrary rule. The binding form needs neither.

This also answers `use-di-2026-11-17.md`'s objection to modelling DI as a destructure. That
objection was to `(…) = context`, where the right side is always the host and so says nothing.
Here the right side is the source, `HTML` or `"svc.bv"`, which varies.

## Quotes

The right side of `use` is in address context. That is what `use` does: it grants that the
source *is* an address. So `use` is not a special form, and the source needs no marker saying it
leaves ordinary expression context. (In program flow it does: see "Backticks".)

A source is a `::` path of segments:

- **A segment that parses as a Brevity name is bare:** `HTML`, `HTML::div`, `path::to::actor`.
- **Any other segment is quoted, in single or double quotes:** `"//host/x"`, `"svc.bv"`,
  `'my-actor'`. Here the quotes delimit a name; they don't make it Text.
- **Quoted segments chain:** `"/service"::Widget`, `HTML::"my-el"`, `"a"::"b"`.
- **The shorthand needs a name as the last segment.** `use HTML::"my-el"` has nothing to bind:
  write `use myEl = HTML::"my-el"`.

Leaving out quotes a name doesn't need is a matter of style, for a lint, not the grammar.

Bare paths (`use :fn = /path/to/actor`) aren't proposed. They would need a lexer mode of their
own: `//host/x` lexes as a comment, `svc.bv` as member access, `my-actor` as subtraction, and
`.`, `-`, `@`, `:` (the Opre separator) and spaces inside one would each need a rule. With quotes,
bare sources are only tokens the lexer already reads, and anything else is a string.

If the host's namespace is hierarchical, `path::to::actor` is the unquoted spelling of
`/path/to/actor`, with the same `::` as `HTML::div`.

## Backticks: the address in program flow

In program flow, an address is written in backticks. They are the signal that a reference goes
outside the ordinary context. This follows `backticks-as-dynamic-names-2026-04-16.md` ("the
service is just an address"):

```brevity
`/service`.send!
`/service`::Widget(5)
```

- **The same reference as after `use`, delimited.** Backticks delimit their whole content, so it
  can be anything: `` `//host/x`.send! ``. A reference made only of names (`HTML::div`) needs
  none.
- **A backtick reference is an implicit `use`.** It is hoisted into the manifest like any `use`,
  so the manifest stays complete and auditable. It binds no name, so there is no lexical scope
  to place.
- **A `use` that binds nothing is optional.** `use "/service"` declares the address up front, for
  audit, and types it: `use "/service" as { send! () => self }` gives every `` `/service` ``
  reference that interface. Without it, the reference's interface comes from `options.remotes`.
- **A binding is never implicit.** `` :div = `/path/to/HTML` `` isn't supported: a binding has a
  scope, and without `use` a reader can't tell a static grant from the host from an ordinary
  runtime destructure of whatever the actor replies. `use :div = "/path/to/HTML"` is the form.

## Open

- **Backticks and local names.** `backticks-as-dynamic-names-2026-04-16.md` also has backticks
  resolve local names (`` `val_{index}` ``). Merging the two lookups would make every reference
  look for a local target in scope first and only then message the parent. Brevity and Opre rest
  on knowing whether a call is internal or external, so that isn't smoothed over: a plain
  backtick is external, the common case. A dynamic local name, if supported, is qualified as a
  reach into self: `` self::`#{ns}_count` ``, or `` ::`#{ns}_count` ``.
- **`use` in value position.** `data = use("/datafile")`, as with JS `import()`. The binding is
  then an ordinary `=`, scoped where it's written. A `use` statement would be sugar for it.
