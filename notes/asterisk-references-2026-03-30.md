# Asterisk references and the death of `ref`, `permit`, and `uses`

Date: 2026-03-30

## Summary

Three keywords — `ref`, `permit`, and `uses` — collapse into two sigils: `*` and `&`. The unifying insight is that `*` means "this is an actor, not a value" and `&` means "I'm passing you a comm channel to an actor I own."

## `*` — actor reference

`*` in Brevity means: this thing has a mailbox. It can receive and respond to messages. It is a service, not a value.

This applies at every scale:

- **Local state**: `a = *Integer(0)` — a is an Integer actor, responds to `<-`
- **Function params**: `|x *Integer|` — x is a reference to an actor the caller owns
- **Constructor dependencies**: `<Remote: *>` — Remote is a service reference resolved from the actor tree
- **Wrapped constructors**: `<super *> { ... }` — constructed around an external actor

`*` is a type. It can be typed (`*Integer`) or untyped (`*`). An untyped `*` in the constructor means "fetch the manifest from the tree."

## `&` — lending a reference

`&` at the call site means: I'm handing you a communication channel to something I own. A socket.

```
a = *Integer(0)
fn = |x *Integer| { x <- 2 }
fn(&a)
```

The caller decides what the callee can do by choosing value or reference:

- `f(a)` — passing by value, callee gets a copy
- `f(&a)` — passing a reference, callee can message the actor

## What dies

### `ref` — replaced by `*`

`ref a = Integer(0)` becomes `a = *Integer(0)`. The `ref` keyword was declaring "this is an actor that accepts effectful messages" — that's what `*` means.

### `permit` — unnecessary

Never implemented, now never will be. The permission model is whether you pass `*` or not. If you bind `a = 1`, closures see a value. If you bind `a = *Integer(1)`, child scopes can message it. No extra keyword needed.

### `uses` — replaced by constructor `< >`

`uses` was a dependency declaration masquerading as an import statement. Dependencies belong in the actor's constructor `< >` because that's what they are — things the actor needs before it can run.

## Constructor syntax: `< >`

Dependencies live in the file's constructor block:

```
<
  Remote: *                        -- path "Remote", resolve manifest from tree
  "/webview": *WebView             -- explicit path, alias WebView (sugar)
  "/console": *                    -- explicit path, no alias
  WebView: * { open: () -> . }    -- inline manifest as type annotation
>
```

Full (unsugared) alias form:

```
<"/logger": (Logger) *>
```

Sugared:

```
<"/logger": Logger*>
```

Shorthand when path matches name:

```
<Logger: *>
```

## Two-phase compilation

Constructor `< >` is the natural boundary between compilation phases:
1. Phase one: parse `< >` to discover dependencies and fetch manifests
2. Phase two: compile the body with manifests resolved

## Design principles

- `*` and `&` are about communication, not memory. This is not C.
- `*` means "I can receive and respond to messages" — a mailbox
- `&` means "I'm passing a comm channel to you" — a socket
- The caller controls access: pass by value or pass by reference
- Same concept at every scale: local `*Integer` and remote `*` in `< >` are both actor references
