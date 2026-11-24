---
status: done
created: 2026-11-18
---
# `use` entries are bindings: target = source

Summary

A `use` entry is a declaration with `use` in front: a binding or destructure whose right side is a source the host resolves. A lone source with no `=` is shorthand: it binds its last segment. The header entry grammar carried over from `**` (`"svc.bv": Svc`, `HTML: (:div)`, `:limit Integer`) is retired.

Syntax

```
use HTML                          // = use HTML = HTML
use HTML, document                // several shorthands
use HTML::div                     // = use div = HTML::div
use "/service"::Widget            // = use Widget = "/service"::Widget
use d = HTML::div                 // rename
use d Div = HTML::div             // rename, typed
use :div = HTML                   // destructure
use :div, :span, p: para = HTML   // parens optional: use (:div, :span, p: para) = HTML
use Svc = "svc.bv"
use Svc = "svc.bv" as { n () -> (Integer) }
use Lib = "lib.bv" as #
use Lib # = "lib.bv"              // = use Lib = "lib.bv" as #
```

- A short claim can type the target instead of following `as`: `use Lib # = "lib.bv"` and `use Lib = "lib.bv" as #` are the same binding, as `x Integer = f()` and `x = f() as Integer` are. use Thing = "thing.bv" as (a: Integer) -> *{ get () -> (Integer) } use limit                         // a value, typed by its interface use limit Integer = limit         // a value, typed here
- Left side: any declaration target: a name, a name and type, or a destructure (named `:x`, renamed `key: local`, positional bare names, `_`, `...`).
- Right side: a source, a `::` path of segments. A segment that parses as a Brevity name is bare; any other is quoted, in single or double quotes ("//host/x", 'my-actor'). Quoted segments chain: "/service"::Widget, HTML::"my-el".
- `as` on the source claims its shape: an interface, `#`, or a constructor profile.
- One statement is either a list of shorthands (`use HTML, document`) or one binding (`use … = source`), never both.

Semantics

- The right side resolves in the host, never in lexical scope.
- Hoisting, scope, and the manifest are unchanged: every top-level `use` goes into the file's manifest, and its names are visible throughout the file actor's top-level scope.
- The same target bound to the same source twice is one manifest entry and one binding.
- A source is an actor or a value; its interface says which. `use limit` with no interface and no type is the existing "has no type" error. With a type (`use limit Integer = limit`) it is a value the host supplies at load, as `:limit Integer` is today.
- Lower each entry to the existing AST (Dependency with destructures, FileParam), so codegen for js, rust and erlang is unchanged. The manifest and `interface.params` are keyed by source, as today.

Errors

- `use :HTML` (a lone sigil): suggests `use HTML`.
- A retired header entry, each pointing to its binding form: "svc.bv": Svc         → use Svc = "svc.bv" HTML: (:div)          → use :div = HTML Svc { … }             → use Svc = "svc.bv" as { … } Svc #                 → use Svc # = "svc.bv" Thing (a) -> *{ … }   → use Thing = "thing.bv" as (a) -> *{ … } :limit Integer        → use limit Integer = limit size: n Integer       → use n Integer = size
- A shorthand whose last segment is quoted (`use HTML::"my-el"`): nothing to bind; write `use myEl = HTML::"my-el"`.
- Shorthands and a binding in one statement (`use HTML, d = x`).
- An accessor (`use @x …`): unchanged.
- `use` in inner scopes and in factory files: unchanged ("not supported yet").

Out of scope

- Backtick references in program flow, and an implicit `use` from them.
- `use` in value position (`data = use("/datafile")`).
- `use` in inner scopes and in factory files.
- `from` naming the calling scope.

Work

- Parser: the `use` statement reads a declaration target and a source, or a shorthand list. Source segments are bare names or quoted strings joined by `::`; `as` takes a shape.
- Lower bindings to the existing Dependency and FileParam nodes. Dedupe on target + source.
- Replace the header-entry parsing inside `use` with the errors above. The `*` factory header keeps its param grammar.
- Migrate tests and examples to the binding forms.

Tests

- Each Syntax line above parses and lowers to the same manifest as the form it replaces.
- `use HTML, document`, and several `use` statements accumulating.
- Parens optional on a destructure: both forms give the same manifest.
- Quoted segments: a path source, a quoted last segment with a rename, "/service"::Widget.
- `as { … }`, `as #`, and `as (params) -> *{ … }` reach codegen with their interfaces.
- A value: `use limit Integer = limit` binds a load-time value (runtime, via constructorArgs).
- The same binding twice is one entry; the same source under two names is two bindings.
- Hoisting: a name bound below is visible above.
- Each error above.
- `use Lib # = "lib.bv"` and `use Lib = "lib.bv" as #` give the same manifest.
