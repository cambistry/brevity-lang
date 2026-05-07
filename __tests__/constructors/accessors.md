# Constructor Parameter Accessors

LLM orientation: constructor parameters can synthesize public accessor handlers.
The tests cover required params, optional params, suppressed accessors, remapped
accessors, and explicit handler override.

## Canonical Forms

Public accessor generated from a constructor param:

```brevity
Box = *(value Integer) {
  @double = -> result: (value * 2)
}

@read = {
  box = Box(21)
  :value Integer = box.value()
  -> :value
}
```

Optional params still generate accessors:

```brevity
T = *(a Integer, b Integer = 99) {
  @sum = -> result: (a + b)
}
```

Suppress an accessor while keeping the local binding:

```brevity
Secret = *((secret) Integer) {
  @double = -> result: (secret * 2)
}
```

Remap a positional param to a public accessor name:

```brevity
T = *((a) :b Integer) {
  @internal = -> result: a
}
```

Here `a` is the internal binding and `b()` is the public accessor.

## Tested Behavior

- Unsuppressed constructor params generate public accessors.
- Optional constructor params return provided values or defaults through their
  accessors.
- Parenthesized params such as `(secret) Integer` suppress accessor generation.
- `(name) :accessor Type` keeps `name` internal and exposes `.accessor()`.
- Explicit `@name` handlers override generated accessors.

## LLM Rules

- Treat accessors as public handlers, not direct field reads.
- Use `t.value()` when showing accessor calls.
- Use parenthesized params for private constructor inputs.
- Do not mention unimplemented accessor variants as available behavior.
