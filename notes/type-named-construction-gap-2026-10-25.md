# Named/XML construction of Types gated by optionality — 2026-10-25

Status: **bug / gap**, found by direct compiler runs (`extract`+`compile`),
not yet fixed.

## Problem

Named-argument construction of a Type — and therefore XML construction, which
lowers to named args — works **only when the Type has at least one optional
field**. All-required Types are positional-only.

| Type declaration | `Point(x: 1, y: 2)` | `<Point x={1} y={2} />` |
|---|---|---|
| `(x: Integer, y: Integer)` all required | ❌ `expects 2 arguments, got 1` | ❌ same |
| `(? x: Integer, ? y: Integer)` all optional | ✅ | ✅ |
| `(x: Integer, ? y: Integer)` mixed | ✅ | ✅ |

Classes, by contrast, accept named + XML whenever their params are named
(`*(x: Integer, y: Integer)`); positional-param classes are rejected with a
dedicated message (`validate.js:1517`).

## Why it happens

The named-binding path for Type construction was built for **optional-bearing
shapes** (you must name a non-trailing optional to set it — positional only
drops from the tail). XML construction (named-only by definition) rides that
same path. Required-only Types never needed naming, so the path was never
wired for them: `Point(x: 1, y: 2)` on an all-required Type is parsed as a
single Object literal `{x:1, y:2}` → arg count 1 → arity error against the 2
expected positional fields.

## Latent bug: all-required single-field slips through

`::Point = (x: Integer)` + `Point(x: 1)` **compiles** — but almost certainly
by arity coincidence, not real binding: one Object arg `{x:1}`, one expected
field, 1 == 1. Likely binds the wrapper object as the value of `x` (so
`Point(x: 1).x` is `{x:1}`, not `1`) rather than naming. Not verified at
runtime. A fix should kill this so it doesn't mask the gap.

## Fix sketch

Extend the optional-field named-binding path to cover required fields too.
Entry points: type-construction arg-binding around `validate.js:818–840`
("positional fields only" comment) and the XML-constructor lowering
(`parser.js:1681` sets `xmlConstructor`; checked at `validate.js:1502`
`checkXmlConstructorCalls`). Then all-required Types become XML-constructible
with no XML-side change, since XML already lowers to named args.

## Reminders
- Attribute values are always `="str"` or `={expr}` — bare `x=1` is rejected
  (`Expected string or {expression} ... got NUMBER`).
- XML form is self-closing only today; `<X>...</X>` body form is a future
  feature (per `__tests__/xml/tags.test.js` header).
