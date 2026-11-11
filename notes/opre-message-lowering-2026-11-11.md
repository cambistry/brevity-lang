# Remote calls lowered to Opre messages — 2026-11-11

A remote call is a message: an address, an op, and args. The front end works out the address
once (`src/opre.js`, run from `validate` after `lowerBareMemberCalls`) and leaves the message on
the call as `call.opre`. Targets send it and don't derive addresses themselves.

Builds on `classes-as-singletons-2026-11-09.md` (sub-services) and
`opre-addresses-as-tokens-2026-11-11.md` (space-delimited tokens).

## The message

```
call.opre = {
  address: { kind: 'static', wire: 'Svc @s @inner', tokens, dep: 'Svc' }
         | { kind: 'value', name?, path },
  op:      '@ping',                      // as targets emit it today
  (args:   the call's own args; targets build slots and ty from them)
  doc:     <sub-document> | null,        // what the call is checked against
  label:   'Svc.s.inner',                // the receiver as it reads in source
}
```

- **Static:** the whole address is known at compile time. A dependency alias (`Svc`), a member path
  through it (`Svc.s.inner` → `Svc @s @inner`; a public member `.x` is wire `@x`), or a local bound
  once to one of those.
- **Value:** the receiver is a value the target evaluates (a cell, a local, a param, an own
  singleton `@s`). Its runtime value is the address.

A member path on a value receiver is lowered only when the value is an actor of a dependency's
class: a local or cell bound to `Svc.Box(1)`. Then `b.tally.get()` is `@get` to `<b> @tally` (`path`
holds the tokens, the target appends them to the runtime address), checked against the class's
sub-services (`__types.Box.services`). Any other `v.field.go()` stays a field read then a call:
nothing in the front end says `v` is an actor, not a typed value with a field.

## Sub-service addresses as values

`x = Svc.s` is the address `Svc @s` (`expr.opreAddress`), not a read of `@s`, when the document
says `s` is a sub-service. Without a document it stays a read. A local bound once to an address
like that is folded: `x.get()` is `@get` to `Svc @s` and `x.inner.ping()` is `@ping` to
`Svc @s @inner`, and the document still checks them.

## What stays with the target

How a message is delivered: in process or on the wire, a direct call or a send, through the file
actor from a class (`outerCall`). Only the address has to come from `call.opre`.

## Checking

Over the same lowered calls, against the sub-document the path leads to (`__services`, and
`__types.X.services` inside a class's doc): an unknown sub-service (`'Svc' has no sub-service
'nope'`), an unknown member (`'Svc.s' has no function 'nope'`), arity and arg types (the
service-call errors, labelled `Svc.s.get()`). A call's return type comes from the sub-document, so
`v Text = Svc.s.get()` is refused when `get` returns Integer. Doc-silent members and doc effects
resolve through sub-services too.

## Out of scope

- The token format of the addresses note (`Box /1`): addresses keep today's wire form.
- What an op contains; local messaging; `set` / `subscribe` addressing.
- The local/global rule.
- How a document names a returned actor (`-> (Anything)`).
- Construction through a sub-service (`Svc.s.Box(1)`).
