# Published Class Params

LLM orientation: class and file params are private unless published with `@`.
A published param gets a public accessor handler that replies with the
param's value. The tests cover positional, named and aliased params, defaults,
file params, the service document, and the retired accessor syntax.

## Canonical Forms

Publish a param with `@`:

```brevity
Box = (@value Integer, @label: Text, secret: Text) *{
  @double = -> result: (value * 2)
}

@read = {
  box = Box(21, label: "b", secret: "s")
  value Integer = box.value()
  return :value
}
```

`value` and `label` are public; `secret` is bound inside the class only.

Defaults work as usual:

```brevity
T = (@a Integer, @b Integer = 99) *{
  @sum = -> result: (a + b)
}
```

Publish a named param under its label while binding a different local:

```brevity
Named = (@label: l Text) *{
  @shout = -> result: l
}
```

A different public name is an explicit handler:

```brevity
Renamed = (a Integer) *{
  @b = { a }
}
```

File params publish the same way:

```brevity
*
  @count Integer
  quiet: Integer
*
```

## Tested Behavior

- Only `@` params get accessors; an accessor call on an unpublished param is
  a compile error (`'T' has no method 'a'`).
- An accessor replies with the value positionally: bind it with
  `value Integer = box.value()`. `:value Integer = box.value()` is a compile
  error.
- The service document lists published params as props (read-only fields; not addresses, so not subscribable)
  (`value Integer`), on the class entry or at the top level for file params.
- A published param and a handler of the same name is a compile error.
- `@` on a function or handler param is a compile error.
- A subclass may override an inherited accessor, keeping its type.
- Retired, each a parse error with a hint: `(name) Type`,
  `(name) :accessor Type`, `name: :accessor Type`,
  `name: (alias) :accessor Type`.

## LLM Rules

- Params are private by default; write `@name` only for values callers need.
- Prefer a `::Type` value over an actor with many published params when the
  thing is plain data.
- Call accessors as `box.value()` and bind them positionally.
