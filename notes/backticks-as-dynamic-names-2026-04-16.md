# Backticks as dynamic name resolution (2026-04-16)

Follow-up to `interface-type-refs-2026-04-16.md`. That note proposed backticks for dynamic/resolvable addresses inside interface documents. This note generalizes the rule to the whole language.

Status: **proposal**, conversational outcome. Not implemented. Extends the earlier note by expanding the role of the backtick delimiter.

## The generalized rule

**Backticks surround content that names a referent via lookup.** The content is evaluated (with interpolation where applicable), and the result is treated as a name to resolve.

Not "address" specifically. Not "interpolated string" specifically. **Name.** Where "name" covers anything that denotes a referent by being looked up somewhere.

One rule, several surfaces:

```
`./dom.bv`                    -- name of a file/constructor
`widget.bv`                   -- name of a service endpoint
`val_{index}`                 -- name of a local binding
`./components/{kind}.bv`      -- name built from a component kind
```

All answer the same question: *which named thing?* Grammar reads the same in every position. Interpolation falls out naturally — once content is evaluated, `{expr}` substitution is just "evaluate the content."

## Why this generalization is coherent

The earlier note framed backticks as "dynamic, will be transformed/resolved." That framing was correct but incomplete. The sharper statement: the *thing being computed* is a name. Resolution happens because a name, by definition, has to be looked up.

- Address `` `./dom.bv` `` — name resolved against the filesystem / distribution network / content-hash store.
- Service literal `` `widget.bv` `` — name resolved as an actor address and dispatched to.
- Interpolated identifier `` `val_{index}` `` — name resolved against the local binding scope.
- Interpolated path `` `./{kind}.bv` `` — name built from a template, then resolved as above.

Uniform semantics: *evaluate the content; resolve the resulting string as a name in the surrounding context.* The "surrounding context" determines which namespace (file system, actor tree, local scope) the lookup targets.

## The "service is just an address" insight

This is the load-bearing payoff, and it's not cosmetic — it's the CAM wire truth surfacing in source grammar.

A DI binding:

```
<Widget: `widget.bv` *>
```

reads honestly: *bind the local identifier `Widget` to the actor at the address `widget.bv`.* The `*` (actor-ref) sigil decorates an *address literal*, not an identifier-that-happens-to-resolve-to-one. The identifier `Widget` is a cached lookup — nothing more.

Strip the DI indirection and you can use the address directly:

```
`widget.bv`.op(params)
```

This sends `op` to the address without a local alias. That's what CAM's wire format always does: `to: <address>, op: '@method'`. The backtick form exposes that truth in the source language. A "service" isn't a distinct kind of thing — it's an address with a published interface describing what messages that address accepts.

Consequence: the interface grammar, the DI grammar, and the direct-invocation grammar all converge on the same primitive. You don't have three different ways to denote "service" in three different positions — you have one delimiter, one meaning, three surfaces.

## What this costs: conventional template literals

In JS / Kotlin / Swift / Scala, backticks (or backtick-like template syntax) denote interpolated *strings*. Brevity's choice reassigns the sigil to *names*.

This means a programmer coming from JS will expect:

```js
`Hello ${name}!`   // produces a string
```

and in Brevity will instead get "the name Hello, {name}!, resolved as..." — which is *not what they want*.

The mitigation: Brevity can host text interpolation in quoted strings uniformly, since single and double quotes are interchangeable and can both support `{...}`:

```
"Hello {name}"
'Hello {name}'
```

No capability is lost — only the naming convention that other languages establish. Given Brevity's deliberate scope (app-definition, not general-purpose), the deviation is defensible on the grounds that the payoff (honest service-as-address semantics, unified interface-doc grammar) outweighs the violated expectation.

## Doors opened

The rule is simple, but it opens capabilities that may be footguns in an app-definition language:

- **Dynamic field access.** `record.` `` `field_{n}` `` — read a field whose name is computed.
- **Dynamic op dispatch.** `actor.` `` `op_{kind}` `` `(args)` — send a message whose op is computed.
- **Dynamic match tags.** `(type: ` `` `variant_{n}` `` `)` — patterns built at runtime.

These fall out of the grammar; they aren't features that need to be added. Whether to allow them in idiomatic Brevity is a separate call — a linter or a scope restriction can reject dynamic forms in positions where static lookup is expected, without changing the grammar.

Worth noting: metaprogramming-adjacent uses (code generation, templating, framework authorship) may genuinely need these. The capability being present doesn't force its use in ordinary application code.

## Resulting delimiter table

If the assignment sticks:

| Delimiter | Meaning |
|---|---|
| `` `...` `` | Name / address / identifier (with interpolation) |
| `"..."`  /  `'...'` | Literal text (with interpolation, interchangeable) |
| `(...)` | Params, tuples, grouping |
| `{...}` | Service / instance interface shape |
| `<...>` | Constructor params; DI / import block |
| `[...]` | Reserved — presumably list literals |

One job per delimiter. The backtick rule is the one that carries the most conceptual weight; the others follow existing conventions.

## Open questions

- **Interpolation in quotes.** If `"Hello {name}"` is interpolated, is there an opt-out for when you want a literal `{`? Standard answer: `\{` or `{{`.
- **Interpolation in backticks.** Same escape question.
- **Lookup context.** The rule says "resolve the resulting string as a name in the surrounding context." That context has to be well-defined syntactically — what namespace a bare `` `foo` `` looks into depends on where it appears. Need to enumerate the contexts and their lookup rules before this is more than a gesture.
- **Static-only positions.** Some positions (DI bindings at module top-level, e.g.) may want to *reject* interpolated backticks — the name has to resolve at compile time, not dynamically. A static-vs-dynamic split inside the backtick form.
- **Interaction with content-hash form.** A pure `` `blake3:abc...` `` is a name in the content-addressed sense, not a path. Lookup is against the content-address store. Fits the rule, worth stating explicitly.
- **Metaprogramming guardrails.** If dynamic field access / op dispatch are possible syntactically but undesirable idiomatically, where's the enforcement — compile-time rejection in certain scopes? linter? runtime-only? Open.

## Rule, restated

Backticks denote **a name to be resolved**, with interpolation as a natural consequence of content evaluation. This covers:

- Addresses in interface documents (the earlier note's case)
- Service endpoints in DI bindings and direct invocations
- Local bindings accessed by computed identifier
- Any other "look this up" position

The underlying claim is that "service," "address," "file reference," and "identifier" are not distinct syntactic categories in Brevity — they are one category (*name*) resolved against different namespaces depending on position. The delimiter makes that unity visible.
