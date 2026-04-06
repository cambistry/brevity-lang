# `uses`

`uses` declares that an actor expects to talk to another actor by name.

It is one of the main ways Brevity makes external collaboration explicit. A
`uses` declaration says that calls to a given name are not ordinary local
function calls. They are outgoing actor calls whose interface can be described
and checked.

## The simple form

At its simplest:

```brevity
uses Remote

@go = {
  Remote.ping() .
}
```

This says that `Remote` is an external collaborator. The file may send messages
to it, but the source does not yet declare a detailed manifest for those calls.

## The typed form

More commonly, `uses` includes an inline service description:

```brevity
uses Remote as {
  greet: (name: Text) -> (greeting: Text)
  ping: () -> .
}
```

Now the compiler has something concrete to validate:

- whether `Remote.greet` exists
- what arguments it expects
- whether it replies
- what reply shape it returns

That makes `uses` a boundary declaration, not just a naming trick.

## `uses` is about actor collaboration

A `uses` target is interacted with through calls that look familiar:

```brevity
greeting: Text = Remote.greet(name: "Alice")
```

But semantically this is not a local function invocation. It is an outgoing
message to another actor, followed by a reply that resumes the current
computation.

That distinction matters because Brevity wants remote collaboration to feel
native without pretending it is the same thing as local evaluation.

## Silent and non-silent calls

`uses` makes an important distinction between:

- calls that reply
- calls that are intentionally silent

```brevity
uses Remote as {
  notify: (msg: Text) -> .
  fetch: (key: Text) -> (value: Text)
}
```

The silent form matters because it lets the interface declare that some outgoing
messages are effects or notifications rather than request-reply interactions.

That in turn affects what the surrounding code is allowed to do. A silent call
cannot be returned as though it produced a value, because its interface says it
does not.

## `uses` sits between local code and deployment details

`uses` names collaborators symbolically:

```brevity
uses Config
uses Remote
uses Math
```

That is different from file-level dependency injection, which binds explicit
paths at the top of the file. `uses` is lighter-weight and more actor-centric:
it says "this actor talks to these collaborators" without pinning the source to
one deployment location syntax.

So a good rough distinction is:

- `uses` for named collaborators in the actor world
- file-level DI for explicitly declared external dependencies of the file-actor

## Why this matters in Brevity

Because Brevity treats actor communication as a first-class part of the
language, it needs a way to make those communications visible in source and
checkable at compile time.

`uses` does that in a compact form. It says:

- this actor depends on another actor
- here is the surface it expects
- calls to that name are part of the program's boundary, not hidden magic

That is one of the reasons the language can talk about distributed or
cross-actor logic without dropping into raw transport code everywhere.
