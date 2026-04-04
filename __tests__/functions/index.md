# Functions

Functions in Brevity are deliberately close to handlers.

This is one of the language's central design choices. Brevity does not try to
maintain a deep conceptual split between:

- public message handlers
- private helper functions
- local lambdas

Instead, it keeps them structurally similar and lets visibility and scope do
most of the differentiating work.

## Public and private functions

At the broadest level, Brevity distinguishes:

- public handlers, written with `@`
- private functions, written with `#`
- local function values, with a bare identifier

A public handler is part of the actor's outside-facing message surface:

```brevity
@hello = -> answer: "world" as Text
```

A private function is callable only within its defining scope:

```brevity
#secret = -> result: 42 as Integer
```

A local function value can be created and passed around inside a larger body:

```brevity
double = |a| a * 2
```

The language keeps these forms related on purpose. That makes it easier to move
between local logic, actor-internal logic, and public behavior without changing
mental models too radically.

## Functions are part of the actor model, not outside it

In Brevity, functions are not a separate "plain language" bolted onto an actor
language. They are one of the ways actor behavior is expressed.

That matters because it keeps the language coherent. The same source file can
contain:

- a public message surface
- internal helper logic
- local closures for small pieces of computation

without feeling like it has switched into a different programming language for
each.

## Lambdas and named functions share a center of gravity

The tests in this directory cover delimited forms, lineal forms, return shapes,
parameter styles, closures, recursion, implicit return, and private scoping.

The point of that breadth is not just to show syntax variety. It is to show
that Brevity tries to give functions one coherent center of gravity:

- a function takes structured input
- it computes within a scope
- it returns a structured result

Whether that function is public, private, or local changes how it is reached,
not the basic shape of what it is.

## Public handlers are the actor's outward vocabulary

Public functions written with `@` are how other actors talk to this one.

That makes them more than ordinary exported functions. They are the actor's
public message vocabulary.

The tests under `public.test.js`, `public_params.test.js`, and
`public_return.test.js` are really about that external boundary: what kinds of
calls the actor accepts and what kinds of replies it produces.

## Private functions are scoped actor-internal tools

Private functions written with `#` are useful because they let an actor define
internal named behavior without publishing it.

That is different from merely omitting `@`. The private marker makes the intent
clear: this function belongs to the internal organization of the actor or the
local scope, not to the actor's public interface.

This helps Brevity avoid an all-or-nothing split between "public handler" and
"anonymous local helper." There is room for named internal structure.

## Closures matter, but so does scope discipline

Functions in Brevity can close over surrounding bindings, but they do so with a
disciplined scope model.

That is why the tests care not only about closure reads, but also about shadowing
and invalid rebinding. The language wants closures to be useful without becoming
an excuse for blurry mutation semantics.

## Why this directory is broad

The `functions/` directory covers a wide range of topics because "function" in
Brevity is not a tiny isolated feature. It is one of the main places where the
language's broader principles become visible:

- structure over ad hoc syntax
- explicit boundaries
- scoping that stays readable
- a close relationship between local computation and actor behavior

That is why it makes sense to treat this directory as a conceptual cluster, not
just a pile of unrelated callable forms.
