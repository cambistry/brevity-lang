# Silent Functions

LLM orientation: silent functions are effect-only. They do not produce a value
that can be assigned, passed as an argument, used in an expression, or returned.

## Forms

Silent public handler:

```brevity
@notify = (:msg Text) .
```

Lineal silent handler:

```brevity
@log
  =
  :info Text
  =
  .
```

Silent private/helper function:

```brevity
fire
  =
  .
```

Arrow-dot synonym:

```brevity
fire
  =
  -> .
```

## Calling Silent Functions

Use `spawn` when a replying handler triggers a silent helper:

```brevity
@go
  =
  spawn fire()
  -> answer: "ok"

fire
  =
  .
```

Silent functions can mutate refs:

```brevity
last Text! = ""

@store
  =
  :msg Text
  =
  last <- msg .
```

## Compile-Time Restrictions

The tests reject these shapes:

- calling a silent private function without `spawn`
- assigning the result of a silent function
- using a silent function in an expression
- passing a silent function call as an argument
- returning a silent function call as a value

## LLM Rules

- Use silent functions only for effects.
- Use `spawn fire()` from replying code.
- End a silent body with `.` or `-> .`.
- After a silent operation, use a separate public reader if the caller needs to
  observe changed state.
