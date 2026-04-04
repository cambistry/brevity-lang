# BVX Constructor Design — Continued (2026-04-02)

## Key Decision: `/>` is XML Only

Self-closing `/>` is reserved for XML instantiation. Constructors always have a body or use `> .` to close:

```
-- XML instantiation
<br />
<p class="memo">body</p>
el = <p class="memo">body</p>

-- Constructor (type, no behavior)
Point = <x Integer, y Integer> {}        -- delimited empty body
Point                                     -- lineal form
<
  x Integer
  y Integer
> .

-- Constructor (with behavior)
Box = <x Integer> { @get = -> x }        -- delimited
Box                                       -- lineal
<
  x Integer
>
@get = -> x
.
```

Lineal no-body form: `> .` closes params with no body. EOF is as good as a dot.

## Extension Syntax: `<<base>>`

Double angle brackets for extension. Visually distinct from `<params>` (declaration) and `<tag>` (XML).

```
counter_p = <<p>> {
  counter *Integer = 0
  @click = { counter <- counter + 1; ::innerHTML <- Text(counter) }
}
```

### With param additions

The `>` closes the base declaration. Additional params follow naturally:

```
<<p> class "custom" />                    -- extend, override defaults, no body (XML instantiation)
<<p> class "custom"> { @click = { } }    -- extend, add behavior
<<p> count Integer> { ... }               -- extend with new params
```

### With super reference

`*name` inside the extension brackets gives a messageable handle to the superclass instance:

```
p1 = <<p>> { @click = { action1 } }
p2 = <<p1 *base>> { @click = { action2; base.click } }
```

- `*base` is not a keyword — any name works (`super`, `inner`, `parent`)
- `base.click` is a normal actor message send — external reference through public API
- Only public handlers are reachable — that's encapsulation, not a limitation
- Optional — `<<p1>>` without a handle is fine when you don't need to call back

### Multiple extension (composition)

```
px = <<p1, p2, p3>>
```

"I don't handle this directly. Ask me again as one of these." Independent, nested state footprints. Does not magically open private scopes.

With handles:

```
px = <<p1 *a, p2 *b>> { @click = { a.click; b.click } }
```

## Actors Are Sealed

Cannot inject state into an actor from outside. Two patterns:

**From outside (closure over external state):**
```
counter *Integer = 0
<p click = |el*| { counter <- counter + 1; el::innerHTML <- Text(counter) }>0</p>
```
- `counter` lives in enclosing scope, handler closes over it
- `el*` is a messageable ref to the p instance
- `::innerHTML` accessed through p's public interface

**From inside (subclass with own state):**
```
counter_p = <<p>> {
  counter *Integer = 0
  @click = { counter <- counter + 1; ::innerHTML <- Text(counter) }
}
<counter_p>0</counter_p>
```
- `counter` is legitimately part of the actor
- `::innerHTML` is self-reference (own public interface)

## Handler Dispatch: Shadowing, Not Chaining

Handlers are pattern-matched, first match wins. Subclass `@click` shadows parent `@click`. No implicit super calls.

To run both: explicitly message the super reference.

```
p2 = <<p1 *base>> { @click = { my_action; base.click } }
```

Chain is explicit at every level. No hidden dispatch.

## Assignment = Class Definition

- `child = <p click={handler}>` — assigned to identifier = reusable constructor/class
- `<div click={handler}>...</div>` — not assigned = one-off instance

Assignment is what promotes an expression to a class.

## Disambiguation Summary

| Form | Meaning |
|------|---------|
| `<x Integer, y Integer> {}` | Constructor declaration |
| `<x Integer, y Integer> .` | Constructor declaration (lineal, no body) |
| `<p class="memo">body</p>` | XML instantiation |
| `<br />` | XML instantiation (self-close) |
| `<<p>> { ... }` | Extension (subclassing) |
| `<<p> new_param Text> { ... }` | Extension with additional params |
| `<<p *base>> { base.click }` | Extension with super reference |

## Open from Previous Session

- Content params (`body... Text`) — named rest capture for tag content
- Closing tag `</name>` as body terminator
- `*` clarification: live messageable actor ref, not subclass marker
