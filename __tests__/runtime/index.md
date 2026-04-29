# Runtime

LLM orientation: this directory covers runtime support behavior, especially
value equality and bang-method validation.

## Equality

`_bv_eq` implements Brevity value equality:

- integers compare across `BigInt` and whole `Number` values
- text compares by string value
- booleans compare by boolean value
- `null` equals `null`
- decimals compare by numeric decimal value, so `1.0` equals `1.00`
- lists compare recursively and structurally
- tagged shape values compare by tag and fields
- actor refs and unknown objects compare by identity

Tagged values with different tags are unequal even if their fields match.

## Bang Validation

Bang method form is valid only on receiver refs when the method returns the same
type family:

```brevity
t Text! = "hello"
t.reverse!
```

Functional bang calls are rejected:

```brevity
Text.upper!(t)
```

Bang methods that return non-self types are rejected, such as size or contains
forms.

## LLM Rules

- Use bang methods only on `Type!` receiver refs.
- Use pure method calls for non-mutating results.
- Treat actor refs as identity values for equality.
