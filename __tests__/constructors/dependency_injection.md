# File-Level Dependency Injection

In Brevity, the file is the actor.

That makes the top of the file an important place: it is where the actor
declares not only its own public surface, but also the external services it
expects to call.

File-level dependency injection does that with a constructor-style header.

## The intended everyday form

The simplest version looks like this:

```brevity
<
  "/database": DB
>

@query
  =
  key: Text
  =
  row = DB.query(:key)
  -> :row
```

The idea is straightforward:

- the file declares that it depends on a service at `"/database"`
- inside the file, that service is referred to as `DB`
- calls like `DB.query(...)` are type-checked against the interface for
  that dependency

In the fully developed model, the compilation environment resolves the
interface automatically from the dependency path. The source file names the
dependency; the compiler host provides the interface description needed to check
calls against it.

That is the important idea to keep in mind when reading the rest of this
feature: file-level DI is meant to make external dependencies feel native to the
language, not bolted on through framework configuration.

## Why this exists

Many languages treat dependency injection as a framework concern layered on top
of ordinary code. Brevity treats it as part of the actor boundary itself.

That is a natural consequence of the file-is-actor model. If the file is the
unit of behavior, then the file header is the right place to declare:

- what this actor depends on
- what local names those dependencies have
- what interfaces the compiler should resolve for them

This makes the environment of the actor part of the program, not just part of a
deployment recipe.

## Dependencies are part of the file boundary

In Brevity, constructor parameters, `uses` declarations, and file-level
dependencies all express versions of the same underlying concern: what this
actor expects to be connected to.

The file-level header is the broadest of those forms. It says: before this
actor can do its work, these services need to exist in its world.

That is why the syntax lives at the top of the file rather than hidden inside a
runtime bootstrap layer.

## External services still feel like actors

Once bound, a dependency is used like any other actor reference:

```brevity
@query
  =
  key: Text
  =
  value: Text = DB.lookup(:key)
  -> :value
```

Calling `DB.lookup(:key)` is still an actor-style call. It sends a message,
waits for a reply if the call is non-silent, and stays within the same broad
message-oriented model as local actor interaction.

That continuity matters. The dependency header does not introduce a separate
FFI syntax or a special RPC subsystem. It gives external services a declared
place inside the actor's world.

## Paths, aliases, and explicit constraints

The simple form above is the intended shape, but Brevity also supports a more
explicit form in which the service constraint is written directly in the source:

```brevity
<
  "/services/db": (DB) {
    lookup: (key: Text) -> (value: Text)
  }
>
```

That form is useful when the compilation host is not resolving interfaces for
you automatically, or when you want the expected interface to be visible in the
file itself.

In that explicit form, each dependency entry contains three pieces:

### Path

The path identifies the dependency in tree or deployment terms:

```brevity
"/services/db"
```

### Alias

The alias is the local name used inside the file:

```brevity
DB
```

### Constraint

The constraint declares the callable interface the file expects:

```brevity
{ lookup: (key: Text) -> (value: Text) }
```

Those three layers matter because the deployment identity of a service, the
local name used in source, and the interface expected by the caller are related
but not identical concerns.

## Why the interface matters

Whether the constraint is resolved automatically or written inline, the point is
the same: the compiler has something concrete to validate against.

That means calls like:

```brevity
DB.lookup(:key)
```

can be checked for:

- method existence
- argument shape
- return shape

before the actor is ever run.

This is one of the main reasons the feature matters. Without a resolved
interface, the dependency would collapse into a generic remote handle and much
of the interesting checking would disappear.

## Why file-level injection is different from `uses`

`uses` names remote actors in a more symbolic way:

```brevity
uses Remote as { ping: () -> . }
```

File-level dependency injection is more concrete. It says that this particular
file-actor is built against these path-identified dependencies.

That makes it especially useful when the actor is part of a larger tree or
deployment environment where location and interface both matter.

So a good rough distinction is:

- `uses` is about named remote collaborators
- file-level DI is about declared external dependencies of the file-actor

Both participate in the same broader model, but they emphasize different parts
of the boundary.

## Adapting a dependency locally

A dependency can also be reinterpreted with `as`:

```brevity
db = DB as { @get: (key: Text) -> (value: Text) }
```

This is useful when the raw dependency name or surface is not the most natural
one for the logic you want to write in the file body.

This shows that the declared dependency surface is not necessarily the same as
the final programming surface used within the file. The actor can adapt a
resolved dependency into a more convenient local interface.

## What this feature says about Brevity

File-level dependency injection is a strong example of Brevity's overall
approach:

- boundaries are explicit
- dependencies are part of source, not hidden wiring
- interfaces are resolved as part of compilation
- external services still participate in the same message-oriented model as
  everything else

In that sense, the feature is not only about DI. It is about making the
environmental assumptions of an actor visible at the language level.
