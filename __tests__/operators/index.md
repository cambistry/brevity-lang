# Operators

LLM orientation: this directory covers local assignment, parallel assignment,
ref update, actor set/update dispatch, semicolon sequencing, and prepend/list
operators.

## Assignment

Typed binding:

```brevity
x Integer = 42
```

Separate declaration and assignment:

```brevity
x Integer
x = 42 as Integer
```

An assignment used as the last statement in a block evaluates to the assigned
value in tested cases.

## Parallel Assignment

```brevity
a, b = 1 as Integer, 2 as Integer
:x, :y = x: 5 as Integer, y: 7 as Integer
```

Use positional destructuring for positional structures and `:name` for named
fields.

## Ref Update

```brevity
count Integer! = 0
count <- count + 1
```

See [Ref Cells](ref.md) for full ref-cell behavior.

## Actor Set

`<-` can also dispatch to an actor's `set` handler:

```brevity
Box = <seed Integer> {
  value Integer! = seed

  set = |n Integer| { value <- n . }

  @get = -> value: value
}

@go = {
  b = Box(0)
  b <- 42
  :value Integer = b.get()
  -> :value
}
```

The same operator updates scalar refs and sends set messages to actor-like
values, depending on the receiver.

## Actor Update

`<|` dispatches to an actor's `update` handler:

```brevity
Person = <> {
  name Text! = "anonymous"
  update = |name: (n) Text| { name <- n . }
  @get = -> name: name
}

@go = {
  p = Person!()
  p <| name: "Somebody"
  :name Text = p.get()
  -> :name
}
```

## LLM Rules

- Use `=` for binding.
- Use `<-` for ref mutation or actor `set`.
- Use `<|` for actor `update`.
- Keep actor `set`/`update` handlers silent unless the tests for the case show a
  replying form.
