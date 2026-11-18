# `use` entries are bindings — 2026-11-18

Decided 2026-11-18 (backticks stay open; `use` in value position is decided below). Replaces the entry grammar of `use-di-2026-11-17.md` (the header
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

## Details settled in the implementation

- **A short claim can type the target.** `use Lib # = "lib.bv"` is `use Lib = "lib.bv" as #`,
  as `x Integer = f()` is `x = f() as Integer`. Claiming on both sides is an error.
- **A typed name is a value.** `use n Integer = size` (or `use n = size as Integer`) is the
  load-time value `size`, bound as `n`; its source must be a name. Untyped, `use limit` is a
  dependency on `limit`, and with no interface it's the usual "has no type" error.
- **One statement, one kind.** A list of shorthands (`use HTML, document`) or one binding,
  never both. A comma before the `=` makes the left side a destructure, so
  `use HTML, d = x` is refused rather than read as a positional destructure.
- **A destructure is by name.** `:x`, `key: local [Type]`, `key: _`, `...`. Positional names and
  a bare `_` aren't supported: a dependency's members have no order.
- **Destructures of one source gather.** `use :div = HTML` and `use HTML::span` are one manifest
  entry for `HTML`. The same source under two names is two bindings.
- **Not yet:** a source of three or more segments, a destructure from a member
  (`use :a = A::b`), and `as` on a member (`use d = HTML::div as …`).
- **The old entries are errors** that name their binding form: `"svc.bv": Svc` →
  `use Svc = "svc.bv"`, `HTML: (:div)` → `use :div = HTML`, `:limit Integer` →
  `use limit Integer = limit`, a lone `:HTML` → `use HTML`.

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

## `use` in value position

Decided 2026-11-18. `use("source")` is an expression: the dependency the host supplies for that
source, as with JS `import()`.

```brevity
svc = use("svc.bv")                              // an actor ref
svc = use("svc.bv") as { n () -> (Integer) }     // claimed with ordinary `as`
:div, :span, p: para = use("HTML")               // destructure
n Integer = use("svc.bv").n()                    // used directly
@go = {
  :div = use("HTML")                             // scoped to @go
  return div()
}
```

- **One string literal.** Single or double quotes, the whole source taken literally (no `::`
  splitting). A bare name (`use(HTML)`), a `::` path, interpolation, no argument or two, and
  `use "svc.bv"` with no parens are errors that name the fix. So is a member reach on the result,
  `use("HTML")::div`: write `:div = use("HTML")`.
- **Static, hoisted.** The source is known at compile time, so every `use("…")` is a manifest
  entry like a statement's, keyed by source: two `use("HTML")`, or one and a `use HTML`
  statement, are one entry. The manifest stays complete.
- **The binding is lexical.** The expression has no local name of its own. It lowers to a
  reference to its entry (a hidden name when no statement names the source). Its binding is the
  ordinary `=` it stands in: `:div = use("HTML")` in a function binds `div` there only, and a name
  bound inline never reaches the file's scope unless it is written there. In a class's
  constructor block the scope is the class.
- **The same for a body-form destructure of a dependency.** `:div = HTML`, with `HTML` from a
  statement, binds where it's written too; it used to fold into the file-wide entry.
- **Shape.** From `as` on the expression (`#`, `{ … }`, `(…) -> *{ … }`), or from
  `options.remotes` (keyed by source); with neither it's the usual "has no type" error. A source
  claimed differently in two places is an error.
- **Anywhere in the file actor**, inner scopes included. The entry is the file's. Not in a
  factory file yet. (So is the `use` statement: see "Inner scopes".)

## Inner scopes

Decided 2026-11-18, as `use-di-2026-11-17.md` has it ("Where it's allowed"). A `use` statement
may be written in any scope: a function body, a branch, a loop body, a class body, a nested
`actor { }`. Details settled:

- **The entry is the file's.** Keyed by source and shared with top-level statements and
  `use("…")`. A source named only inside gets an entry of its own; it is never bound file-wide.
  Dependencies are addressed by source, so the entry's internal key never reaches the wire.
- **Hoisted within its scope.** An inner `use` binds the whole of its scope, above its line
  too, as a top-level `use` binds the whole file. An inline `use("…")` binding still follows text
  order, like any `=`.
- **The scope.** A block's statement binds that block and the blocks inside it; a class body's
  binds the class and the classes nested in it. A `use` in one branch is unknown in the other and
  after the conditional.
- **Shadowing.** An inner `use` shadows an outer binding of the name (a local, a param, an outer
  `use` of another source); a nested scope that rebinds the name keeps its own. The same holds
  for `use("…")` bindings and body-form destructures.
- **One binding per name in a scope.** A local, param, method or cell of the same name in the
  `use`'s own scope is an error, and so is assigning to it (`svc = 1`, `svc <- 1`).
- **A typed value** (`use n Integer = limit`) binds the file's load-time value `limit` in its
  scope; the entry is shared with a top-level `use limit Integer = limit`. Two types for one key
  anywhere in the file are an error.
- **Not in a factory file** yet, as at top level.

## Open

- **Backticks and local names.** `backticks-as-dynamic-names-2026-04-16.md` also has backticks
  resolve local names (`` `val_{index}` ``). Merging the two lookups would make every reference
  look for a local target in scope first and only then message the parent. Brevity and Opre rest
  on knowing whether a call is internal or external, so that isn't smoothed over: a plain
  backtick is external, the common case. A dynamic local name, if supported, is qualified as a
  reach into self: `` self::`#{ns}_count` ``, or `` ::`#{ns}_count` ``.
- **The `use` statement as sugar for `use("…")`.** Not yet: the statement's `::` paths,
  shorthands and claims don't map one-to-one onto the expression.
