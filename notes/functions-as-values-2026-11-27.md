# Functions as values — 2026-11-27

Decided with the user on 2026-11-27. Builds on `opre-tagged-forms-2026-11-24.md` (the `['%f', sig]`
form) and `actors-not-classes-2026-11-18.md` (an actor as a value is its address).

## A function as a value is its address

An address in a value is bracketed and relative to the actor that holds it, as a class it declares
is `#<:C>`.

- **One of the actor's own functions** (`-> &f`) is `#<:~f>`.
- **A lambda** (bound to a local, held in a `*Function` cell, or replied as `&g`) is `#<:@N>`,
  answered by its `@N` arm, as a lambda passed into a call or a type field already was. `N` is
  numbered by each target; it skips any `@N` a lifted closure already names.
- **A call through the value** reaches the function. A self-address (`#<:@N>`) is the actor's own
  `@N` arm.

A bare label (`~f`, `~_lambda_0`) is never a value on the wire: it's an internal dispatch key.

## Its tag is its signature

A function value is tagged with its signature in the tagged form, `['%f', { args, re, writes }]`.
A lambda in a `*Function` cell with no signature declared is tagged `Function`. The tag is the same
on every target.

## `test.get` on a function

`test.get '~f'` names the function by its label (`~f`, a member, not an address) and replies its
address, typed with its signature: `re: ['#<:~f>'], ty: [['%f', { args, re, writes }]]`. A
function that writes has `writes: true`; one with no reply has `re: []`.

## Open

- Calling a function value that holds another actor's address (`#<x:@N>`) sends to that actor. Not
  yet exercised by a test.
