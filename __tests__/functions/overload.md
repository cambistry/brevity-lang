# Function Overloads

LLM orientation: functions are ordered overloads. `=` creates the first clause;
`<<` appends later clauses.

## Basic Form

```brevity
@calc = |a Integer| -> result: a
@calc << |a Integer, b Integer| -> result: (a + b)
```

Lineal form:

```brevity
add
  =
  a Integer
  =
  -> result: a

add <<
  =
  a Integer
  b Integer
  =
  result Integer = a + b
  -> result: result
```

## Dispatch

- Clauses are tried in order.
- First matching clause wins.
- More specific clauses should appear before more general clauses.
- Optional args can make a clause match when the caller omits an arg.

## Redefinition Rules

This is valid:

```brevity
@calc = |a Integer| -> result: a
@calc << |a Integer, b Integer| -> result: (a + b)
```

This is a redefinition error:

```brevity
@calc = |a Integer| -> result: a
@calc = |a Integer, b Integer| -> result: (a + b)
```

`<<` requires a prior overload:

```brevity
@calc << |a Integer| -> result: a
```

is an error unless `@calc` already exists.

## Empty Overload

`Function()` creates an empty overload:

```brevity
fn = Function()
fn << |a Integer| -> a
```

Calling an empty overload is unhandled.

## LLM Rules

- Use `=` once per function name.
- Use `<<` for additional clauses.
- Keep overloads adjacent when possible.
- Make return shapes consistent unless the overload intentionally varies by
  message type.
