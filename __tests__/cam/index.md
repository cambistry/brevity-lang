# CAM / Interop

The tests in this directory cover actor interaction across boundaries.

Some of these boundaries are remote actors named with `uses`. Some are more
protocol-oriented cases involving instance creation, request-reply chains, or
callback flows. What unifies them is that they show Brevity behaving as a
language for communication between actors, not just for local computation inside
one file.

## Why this area matters

Brevity becomes most distinctive when code crosses a boundary:

- one actor calls another
- an external service replies
- a remote instance is constructed and then addressed directly
- a chain of request and reply spans multiple actors

That is where the language's message-oriented model stops being a slogan and
starts becoming concrete.

## Themes in this directory

### Outgoing calls

Features like `uses` and external sends show how an actor expresses dependency
on another actor without dropping into raw transport code everywhere.

### Instance-oriented interaction

Remote instance construction and subsequent routing show that Brevity can model
resources or external objects as actor-like participants rather than treating
them as foreign exceptions.

### Multi-actor workflows

The interop tests demonstrate request-reply chains and callbacks across several
actors. These are especially useful because they make it clear that Brevity's
surface syntax is meant to support distributed or cross-process workflows, not
just local toy examples.

## Documents in this directory

- [Remote Interop](interop.md)
- [Remote Instances](remote_instance.md)
