# Constructor Ingest

`ingest` is the mechanism by which a superclass receives a value from its
subclass during construction.

This document covers the constructor-level behavior of ingest. For the
keyword itself, see [keywords/ingest.md](../keywords/ingest.md).

## How it works

When a superclass's service block contains `ingest`, the construction
sequence changes:

1. The superclass begins its service block
2. At `ingest`, the superclass pauses
3. The subclass's service block runs to completion
4. The subclass's return value is delivered to the superclass
5. The superclass resumes with the ingested value bound

This is a cooperative handoff, not a callback or event. The superclass's
initialization is literally suspended until the subclass finishes its
service block.

## Syntax

In the superclass:

```brevity
Base = <> {
  name Text = ingest
  @name = -> :name as Text
}
```

In the subclass — the service block returns a value:

```brevity
-- Inline form: service block is just the return value
Greeting = <Base |> -> "hello"

-- Block form: declarations then return
Computed = <Base |> {
  prefix = "item"
  suffix = "001"
  -> (prefix + "-" + suffix)
}
```

## Default values

`ingest` can provide a fallback for when no subclass supplies a value:

```brevity
Panel = <> {
  content Text = ingest("")
  @content = -> :content as Text
}
```

With a default, the type can be constructed directly:

```brevity
Panel()              -- content is ""
<Panel |> -> "hi"    -- content is "hi"
```

Without a default, direct construction is a compiler error:

```brevity
Base = <> { name Text = ingest }
Base()               -- compiler :error Base uses ingest, requires a subclass
```

## Interaction with constructor params

Ingest and constructor params are independent. A superclass can have both:

```brevity
Labeled = <:id Integer> {
  label Text = ingest
  @info = -> :id, :label
}

Named = <Labeled |> -> "widget"

-- Constructed as:
n = Named(id: 42)
-- n.info() returns { id: 42, label: "widget" }
```

The ingested value comes from the subclass's service block, not from the
constructor call site. Constructor params come from the call site.

## Interaction with inheritance

Ingest does not affect handler inheritance. A subclass still inherits all
public and protected handlers from the superclass, and can override them.

The only thing ingest adds is a value flowing from subclass service block to
superclass initialization — it does not create a new handler or change the
dispatch chain.

## Type safety

If the superclass declares a type for the ingested value:

```brevity
Base = <> { name Text = ingest }
```

then the subclass's return must satisfy that type:

```brevity
Good = <Base |> -> "ok"          -- Text: valid
Bad = <Base |> -> 42             -- Integer: compiler error
```

The ingest type appears in the superclass's interface so the compiler can
check this at the subclass definition site, even for remote superclasses.

## Multiple levels

Each `ingest` is a local relationship between one superclass and its direct
subclass. They don't interact or relay through each other.

If a type both provides a value to its superclass and ingests from its own
subclasses, those are two independent operations:

```brevity
A = <> { fromB Text = ingest }

B = <A |> {
  fromC Integer = ingest    -- B ingests from its own subclasses
  -> "value for A"          -- B provides to A (independent of fromC)
}
```

B's return to A is fixed — it doesn't depend on what B ingests from C.
A never sees C's return value. Each `ingest` receives from its direct
child only.
