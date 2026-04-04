# Constructor Parameter Accessors

Constructor parameters in Brevity are not just initialization inputs. They are
part of the actor's public boundary.

One consequence of that is that constructor parameters can automatically become
public accessor handlers.

## The basic idea

If a constructor parameter is named directly, Brevity synthesizes a public
handler for it.

```brevity
Box = <value Integer> {
  @double = -> result: (value * 2) as Integer
}
```

The `value` parameter is available inside the constructor body as a local
binding, but it also implies a public handler:

```brevity
box = Box(21)
current = box.value()
```

Conceptually, that is as if the actor had been given:

```brevity
@value = -> value: value as Integer
```

but without forcing the author to write boilerplate for each field.

## Why this matters

Brevity treats actors as the main unit of behavior, not passive data
containers. That means "reading a field" is not special syntax or direct memory
access. It is still a message send.

Auto-accessors are a convenience for that model.

They let a constructor expose stable, explicit read access to parts of its
boundary without turning the language into a record system with a separate
access path.

In other words:

- constructor parameters define what an actor is initialized with
- public handlers define what an actor exposes
- auto-accessors are the overlap between those two ideas

## Accessors are still handlers

An accessor is not a privileged back door. It behaves like any other public
message.

That means it composes naturally with the rest of the language:

```brevity
Pair = <a Integer, b Integer> {
  @sum = -> total: (a + b) as Integer
}

@show
  =
  pair = Pair(3, 7)
  left: Integer = pair.a()
  right: Integer = pair.b()
  total: Integer = pair.sum()
  -> left: left, right: right, total: total
```

The actor is still being interacted with through messages. The accessors simply
save you from spelling out the obvious ones by hand.

## Suppressing an accessor

Not every constructor parameter should automatically become public.

If a parameter is wrapped in parentheses, its auto-accessor is suppressed:

```brevity
Secret = <(secret) Integer> {
  @double = -> result: (secret * 2) as Integer
}
```

Here `secret` is still available inside the actor body, but there is no implied
public `@secret` handler.

That distinction matters because constructor parameters often play two roles:

- some define the public shape of the actor
- some are internal implementation details captured at construction time

The parenthesized form lets you keep those internal details in the constructor
without automatically publishing them.

## Remapping the accessor name

The public accessor does not have to use the same name as the incoming
constructor field.

You can map an incoming key to a different accessor name:

```brevity
Thing = <a: :b Integer> {
  @show = -> value: b as Integer
}
```

Here the constructor receives the value under the external key `a`, binds it
internally as `b`, and exposes the generated accessor as `@b`.

That means the call shape and the accessor shape can differ deliberately:

```brevity
thing = Thing(a: 7)
value = thing.b()
```

This is useful when:

- the construction-time vocabulary and the steady-state actor vocabulary differ
- you want a cleaner accessor name than the incoming wire key
- you want to normalize external naming into the actor's internal interface

There is also a more private remapped form:

```brevity
Thing = <a: (b) :c Integer> {
  @show = -> value: b as Integer
}
```

In that shape:

- `a` is the incoming key
- `b` is the internal local binding
- `c` is the generated accessor name

This lets constructor input naming, internal implementation naming, and public
accessor naming all diverge when needed.

## Explicit handlers win

Auto-accessors are defaults, not mandates.

If you define a handler with the same name explicitly, your handler takes
precedence:

```brevity
Counter = <value Integer> {
  @value = -> result: (value + 100) as Integer
}
```

Now `counter.value()` uses the explicit handler body, not the generated accessor.

This is important because it keeps the feature ergonomic without making the
language rigid. A constructor parameter can start life as a simple exposed
field, and later grow custom behavior without changing the public call shape.

## Accessors and constructor design

Auto-accessors make constructor design more consequential.

When choosing constructor parameters, you are not only deciding what values an
actor closes over. You are also sketching the surface that other actors may
read from.

That encourages a style where constructors are treated as a real part of the
interface, not just setup plumbing hidden before the "real" API begins.

This is one of the recurrent themes in Brevity:

- the constructor boundary matters
- the public boundary matters
- the language tries to keep those two boundaries close together

## What this feature is not

Auto-accessors do not turn actors into plain structs.

They do not introduce a second, non-message-oriented access model.

They are better understood as a small piece of API synthesis: if a constructor
parameter is clearly part of the actor's outward shape, Brevity can expose that
shape directly unless you say otherwise.

That keeps simple actors concise while preserving the language's more general
rule that interaction happens through named messages.

One further variant is worth noting even though it is not yet implemented:

```brevity
<(a) :b Integer>
```

The intent there is a positional constructor argument with a suppressed incoming
name but a public `.b` accessor. That continues the same general pattern:
constructor input shape, internal binding shape, and public accessor shape are
related, but not required to be identical.
