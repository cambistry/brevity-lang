# BVX Constructor Design — Syntax and Semantics

## XML Construction Syntax

`<p class="memo">body</p>` is an alternative syntax for `p(class: "memo", body: "body")`. The angle-bracket form is constructor invocation, not declaration.

This is valid Brevity, not a separate language. `.bvx` files allow it because they know they're in a DOM context, but the grammar is the same.

## Constructor Extension (Pipe Separator)

The `|` after the first identifier marks it as a base class:

```
custom = <h1 | class="customized" />

widget = <
  div |
  id "widget"
  click { handler }
/>
```

No pipe = no base class, just params. The pipe is the signal.

Disambiguation is trivial: `|` can't appear after the first token in a param declaration, so `<h1 | ...>` is unambiguously "extends h1."

## Content Params (`...` Capture)

A named param with `...` captures body content between open/close tags:

```
p = <body... Text />
div = <children... XML />
```

- `body... Text` — "body captures content, typed as Text"
- `...` attaches to the name, not the type
- The name is not reserved — `body`, `content`, `inner`, whatever
- `/>` (self-close) = no body allowed; `>` (open) = body follows, terminated by closing tag

Usage:

```
<p>hello</p>           -- body receives "hello"
<div><p>...</p></div>  -- children receives child elements
```

## Superclass-First Param Disambiguation

When the first token inside `<>` has no type annotation:

| Form | Parse | Why |
|------|-------|-----|
| `<p>` | instantiation (superclass) | bare ident, no type |
| `<p Integer>` | param `p: Integer` | has type |
| `<p \| class "x">` | extends p | pipe separator |
| `<p class="x">` | instantiation of p | XML attr pattern (name=value, no type) |
| `<p*>` | wrapped actor ref | existing ref syntax |

## Clarification: `*` Semantics

`*` means "this is a live, messageable actor reference." Without it, a value is a declaration-time closure capture.

- `<i *Integer>` — live settable reference, can receive mutation messages
- `<i Integer>` — captured at construction, immutable from outside
- `*` in constructors/functions is about messaging capability, not subclassing

## Exposed Hooks (Not Subclassing)

HTML element behavior through constructor params:

```
<p click={ do_something }>              -- 0-arity block
<p click = |e Event| { do_something }>  -- overloaded to accept event
```

The `p` constructor exposes `click` as a param that accepts a block. This is configuration, not subclassing. The hook is part of p's public interface.

## Extension Example

```
component = <p | class "title"> {
  @set_text = |t| ::innerHTML <- t
}
```

Extends `p`, overrides `class` default, adds a handler. Usage:

```
<component class="subtitle">content</component>
```

`class="subtitle"` overrides the extension default. `content` goes to p's body content param.

## Open Questions

- Closing tag syntax (`</name>`) as body terminator — replaces `.` in element context. Worth having even for non-element subclasses?
- Content type declarations (`... JSON`, `... XML`) — compile-time contract about body parsing. Probably not v1.
- Can/should extension be chained? `<div | class "a"> { ... }` extended by `<custom | class "b">`?
