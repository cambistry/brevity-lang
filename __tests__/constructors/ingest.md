# Constructor Ingest

`ingest` is the mechanism by which a supertype receives a value from its
subtype during construction.

This document covers the constructor-level behavior of ingest. For the
keyword itself, see [keywords/ingest.md](../keywords/ingest.md).

## How it works

When a supertype's service block contains `ingest`, the construction
sequence changes:

1. The supertype begins its service block
2. At `ingest`, the supertype pauses
3. The subtype's service block runs to completion
4. The subtype's return value is delivered to the supertype
5. The supertype resumes with the ingested value bound

This is a cooperative handoff, not a callback or event. The supertype's
initialization is literally suspended until the subtype finishes its
service block.

## Syntax

In the supertype:

```brevity
Base = <> {
  name Text = ingest
  @name = -> :name as Text
}
```

In the subtype — the service block returns a value:

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

`ingest` can provide a fallback for when no subtype supplies a value:

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
Base()               -- compiler :error Base uses ingest, requires a subtype
```

## Interaction with constructor params

Ingest and constructor params are independent. A supertype can have both:

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

The ingested value comes from the subtype's service block, not from the
constructor call site. Constructor params come from the call site.

## Interaction with inheritance

Ingest does not affect handler inheritance. A subtype still inherits all
public and protected handlers from the supertype, and can override them.

The only thing ingest adds is a value flowing from subtype service block to
supertype initialization — it does not create a new handler or change the
dispatch chain.

## Type safety

If the supertype declares a type for the ingested value:

```brevity
Base = <> { name Text = ingest }
```

then the subtype's return must satisfy that type:

```brevity
Good = <Base |> -> "ok"          -- Text: valid
Bad = <Base |> -> 42             -- Integer: compiler error
```

The ingest type appears in the supertype's interface so the compiler can
check this at the subtype definition site, even for remote supertypes.

## Multiple levels

Each `ingest` is a local relationship between one supertype and its direct
subtype. They don't interact or relay through each other.

If a type both provides a value to its supertype and ingests from its own
subtypes, those are two independent operations:

```brevity
A = <> { fromB Text = ingest }

B = <A |> {
  fromC Integer = ingest    -- B ingests from its own subtypes
  -> "value for A"          -- B provides to A (independent of fromC)
}
```

B's return to A is fixed — it doesn't depend on what B ingests from C.
A never sees C's return value. Each `ingest` receives from its direct
child only.
