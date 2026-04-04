# `self as`

`self as` lets an actor define how it should be viewed as a value.

This is one of the places where Brevity blurs a boundary that many languages
keep rigid: an actor is not only a thing with handlers. It can also declare
typed views of itself.

## The basic form

An actor can include one or more `self as` clauses:

```brevity
One
  <>
  =
  self as Integer = -> 1
  self as Text = -> "one"
  @ping = -> pong: "ok" as Text
  .
```

Now the same actor can be used in more than one way:

```brevity
n Integer = One()
t Text = One()
```

The target type determines which `self as` clause applies.

## Why this exists

Brevity treats actors as the main unit of behavior, but many actors also have a
natural projection into simpler values.

An actor might be:

- a counter that can be viewed as an `Integer`
- a label that can be viewed as `Text`
- a wrapper that can provide a default scalar representation

`self as` makes that projection explicit. Instead of relying on implicit
conversion or special casing, the actor spells out which views it supports.

## Typed views, not method calls

`self as` is different from adding another public handler.

This:

```brevity
self as Integer = -> 42
```

is not the same as:

```brevity
@to_integer = -> result: 42 as Integer
```

The handler form adds another named message to the actor's public API.

The `self as` form says something more structural: this actor itself may stand
in for a value of a given type when the surrounding code expects that type.

That makes `self as` part of the type story, not just the method story.

## Multiple views can coexist with handlers

An actor does not stop being an actor because it has `self as` clauses.

```brevity
Dual
  <>
  =
  self as Integer = -> 7
  @greet = -> msg: "hi" as Text
  .
```

This actor can be treated as an `Integer`, but it still has a callable public
surface through `@greet`.

That is important because `self as` is not an alternate replacement for public
handlers. It is an additional layer of meaning: the actor can participate both
as an interactive service and as a typed value.

## Catch-all views

The negated form broadens the idea:

```brevity
self as !Wrapper = -> 0
```

This says, in effect, "for targets other than the actor's own self type, use
this projection."

That is useful for wrapper-like actors that want a general fallback
representation without enumerating every possible target type one by one.

## When `self as` is useful

`self as` tends to be valuable when an actor's identity and its projection are
both important.

Examples:

- wrapper actors around scalar configuration or defaults
- actors representing domain values with both behavior and canonical display
- boundary objects that need a typed public projection for composition

In all of those cases, using only explicit handlers can feel slightly indirect,
because the actor is not merely answering a named question. It really does have
a typed value interpretation.

## Why not implicit conversion everywhere

Without `self as`, a language often drifts toward either:

- ad hoc coercion rules
- or proliferating `to_*` helper methods

Brevity chooses neither. The conversion is explicit, local to the actor, and
type-directed.

That keeps the projection readable:

- readers can see exactly which views an actor supports
- unsupported target types fail clearly
- the actor remains the authority on its own value-level meaning

## What `self as` says about Brevity

This feature reveals something broader about the language.

Brevity does not treat actors as merely remote endpoints. An actor can also be
a typed thing whose meaning is partially described by the forms it can project
into.

That makes the language feel less like "objects plus async methods" and more
like a system where behavior, type, and boundary are all negotiated together.
