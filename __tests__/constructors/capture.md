# Constructor Capture

`capture` is the mechanism by which a supertype receives a value from its
subtype during construction.

This document covers the constructor-level behavior of capture. For the
keyword itself, see [keywords/capture.md](../keywords/capture.md).

## How it works

When a supertype's declaration block contains `capture`, the construction
sequence changes:

1. The supertype begins its declaration block
2. At `capture`, the supertype pauses
3. The subtype's declaration block runs to completion
4. The subtype's return value is delivered to the supertype
5. The supertype resumes with the captured value bound

This is a cooperative handoff, not a callback or event. The supertype's
initialization is literally suspended until the subtype finishes its
declarations.

## Syntax

In the supertype:

```brevity
Base = <> {
  name Text = capture
  @name = -> :name as Text
}
```

In the subtype — the declaration block returns a value:

```brevity
-- Inline form: declaration is just the return value
Greeting = <<Base>> -> "hello"

-- Block form: declarations then return
Computed = <<Base>> {
  prefix = "item"
  suffix = "001"
  -> (prefix + "-" + suffix)
}
```

## Interaction with constructor params

Capture and constructor params are independent. A supertype can have both:

```brevity
Labeled = <id: Integer> {
  label Text = capture
  @info = -> :id, :label
}

Named = <<Labeled>> -> "widget"

-- Constructed as:
n = Named(id: 42)
-- n.info() returns { id: 42, label: "widget" }
```

The captured value comes from the subtype's declaration, not from the
constructor call site. Constructor params come from the call site.

## Interaction with inheritance

Capture does not affect handler inheritance. A subtype still inherits all
public and protected handlers from the supertype, and can override them.

The only thing capture adds is a value flowing from subtype declaration to
supertype initialization — it does not create a new handler or change the
dispatch chain.

## Type safety

If the supertype declares a type for the captured value:

```brevity
Base = <> { name Text = capture }
```

then the subtype's return must satisfy that type:

```brevity
Good = <<Base>> -> "ok"          -- Text: valid
Bad = <<Base>> -> 42             -- Integer: compiler error
```

The capture type appears in the supertype's interface so the compiler can
check this at the subtype definition site, even for remote supertypes.

## Chaining

Each level can capture independently. A subtype can provide a value to its
supertype and also capture from its own subtypes:

```brevity
A = <> { fromChild Text = capture }
B = <<A>> {
  fromGrandchild Integer = capture
  -> "value for A"
}
C = <<B>> -> 99
```

Each `capture` receives from its *direct* child only. A does not see C's
return value — it sees B's return value. B sees C's.
