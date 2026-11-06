# Silent Functions

LLM orientation: silent functions are effect-only. They do not produce a value
that can be assigned, passed as an argument, used in an expression, or returned.
Silence is in the name: a silent function is named with a glued `.`
(`fire.`, `@notify.`). Its type is `(…) => .`.

## Forms

Silent public handler:

```brevity
@notify. = (msg: Text) {}
```

Lineal silent handler (an empty body ends at the blank line):

```brevity
@log.
  =
  info: Text
  =

```

Silent private/helper function:

```brevity
fire. = { count <- count + 1 }
```

A body never ends in `.` — that is an error naming the fix. A bare `return`
exits early; `return value` is an error:

```brevity
bump. = (n Integer) {
  if n > 100 {
    return
  }
  x <- n
}
```

## Calling Silent Functions

A silent call ends in `...` (fire-and-forget). Right after the name the
ellipsis absorbs the dot: `fire...`, never `fire....`. Elsewhere the dot is
written: `bump(7)...`, `Log.write(:message)...`. `spawn fire.()` also works.

```brevity
@go
  =
  fire...
  return answer: "ok"

fire. = {}
```

`fn` and `fn.` may both exist; `...` is illegal on a value-returning call, so
`fn...` always means `fn.`. The dot is part of the name on the wire too: the
op is `@notify.`.

Silent functions can mutate refs:

```brevity
last *Text = ""

@store.
  =
  msg: Text
  =
  last <- msg
```

## Compile-Time Restrictions

The tests reject these shapes:

- calling a silent function without `...` (or `spawn`)
- `...` on a function that returns a value
- a trailing `.` in a named function body
- assigning the result of a silent function
- using a silent function in an expression
- passing a silent function call as an argument
- returning a silent function call as a value

## LLM Rules

- Use silent functions only for effects; name them with a glued `.`.
- Call them with `...` from replying code.
- Lambdas still end a silent body with `.` (pending a separate change).
- After a silent operation, use a separate public reader if the caller needs to
  observe changed state.
