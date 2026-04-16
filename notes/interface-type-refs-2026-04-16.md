# Type references in interface documents (2026-04-16)

Design conversation. How should an interface document express types that come from other services/constructors, in a way that is legible and location-agnostic when the document crosses devices or tree positions.

Status: **proposal**, conversational outcome. Not implemented. No tests yet.

## The problem

In Brevity, a "type" is not an abstract shape — it is defined by a service or a file-constructor. A consumer of an interface either:

1. Calls a service and requests an instance (gets an address), or
2. Spawns an instance from a specific, addressable compile-time resource (a `.bv` file).

This means every custom type named in an interface has a *provenance*: some addressable resource where the type is defined. An interface document that mentions a custom type has to encode that provenance in a way its reader can resolve.

Concretely: given a file

```
<DOM: (dom) *>
=
@content = -> DOM.first(selector: ".content")
```

what does the published interface look like? `{ content: () -> DOM.Element }` is not enough on its own — `DOM` is a local DI name, meaningless to a consumer elsewhere in the tree or on another device.

The interface has to *carry the address*, not just a local alias.

## Precedents reviewed

- **Scala path-dependent types.** `x.T` where `x` is a term-level value; the type projection depends on which specific value is bound. Closest match for the *in-source* case where `DOM` is in DI scope.
- **Unison.** Types have content hashes; names are aliases. Cross-codebase identity is structural. Aligns with "type symbols: path + content hash for cross-app identity."
- **Dhall.** Imports are first-class values. A URL/path/hash is a literal expression. `{ content : () -> https://host/Element.dhall }` is valid grammar. Semantic integrity hashes (`sha256:...`) make identity location-independent; URL is a fetch hint, hash is identity. `as Location` imports a reference without resolving it — precisely what an interface doc needs.
- **ML / OCaml modules.** `Mod.t`. Static namespaces, link-time resolution.

Dhall is the closest analog: *address-as-first-class-expression* inside a type position.

## The syntactic question

Putting bare addresses in type position inside parens — `{ content: () -> (./dom.bv).Element }` — is fragile. The grammar would be leaning on content inspection (`./` means "this is a path, not a tuple") to disambiguate from parameter lists, tuple returns, and grouped unions. Parens are already load-bearing elsewhere in interface syntax.

Addresses need their own delimiter.

## Decision: backticks for dynamic/resolvable content

```
{ content: () -> `./dom.bv`.Element }
{ content: () -> `https://host/dom.bv`.Element }
{ content: () -> `blake3:abc123...`.Element }
```

**Rule:** backticks surround content that is **dynamic** — content the system will transform, resolve, rewrite, or interpret.

Why backticks carry this signal:

- JS template literals — dynamic interpolation
- Shell backticks — command substitution, evaluated
- Markdown `` ` `` — "interpret this, don't take it at face value"

All three train the reader to read backtick content as *something that will be transformed before it means anything concrete*. Which is exactly the case here: a path gets rewritten per receiver tree position; a URL may be resolved to a local cache hit or a mirror; a content hash needs lookup. Contents *require* interpretation.

Double and single quotes are reserved for **static** content — literal text, match-value tags. Example of static dispatch tags in an interface:

```
{
  oper: (type: "Basic", ...) -> Integer
  oper: (type: "Advanced", ...) -> Float
}
```

Match literals belong in the interface — `type: "Basic"` tells the consumer which constructor dispatches where, structural info, not noise.

The rule is: *the kind of content picks the delimiter, not the role in the doc.* Backtick = will be transformed; quote = as-is.

Double and single quotes remain interchangeable in Brevity (each escapes itself). The static/dynamic axis is what the backtick opt-out adds.

## Handles the constructor case too

A constructor interface works identically. `wrapper.bv` might publish:

```
<`DOM`.Element> -> {
  next: () -> (`DOM`.Element)
  body: () -> (Text)
}
```

Consumed as:

```
<
  DOM: (:Element) *
  "wrapper.bv": (Wrapper) #
>
=
el = <Element />
wrapper = Wrapper(el)
```

The `<...> -> {...}` shape is the structural difference between service and constructor docs; the type-reference grammar inside is identical. Both ask the same question — "what does this symbol denote?" — and the answer is the same: an address, resolvable to a content hash.

### Invariants worth naming

1. **Intra-document consistency.** The two `` `DOM` `` occurrences in `wrapper.bv` (param and `next` return) must resolve to the *same* address. The type-checker enforces this as a doc-internal invariant before anyone else reads the doc.

2. **Cross-document identity = address equality.** When the consumer types `Wrapper(el)`, the check is: does `el`'s type address equal the param-slot address declared in `wrapper.bv`? If both `` `DOM` `` references (wrapper's declared, consumer's bound) resolve to the same content-hashed resource, they match. This is Unison-style nominal-by-hash identity — no structural guessing.

3. **Wrapper has its own DI.** Nothing in `wrapper.bv`'s interface obliges the consumer to also bind DOM — `wrapper.bv` imports DOM on its own terms. The consumer only needs DOM in *their* scope insofar as they need to *produce* an `Element` to pass in. That's argument construction, not transitive dependency.

4. **Per-receiver rewriting lives inside backticks.** When `wrapper.bv`'s interface ships to a remote consumer, its `` `./dom.bv` `` may be rewritten to `` `https://origin/dom.bv blake3:...` `` (or a pure hash). The outer grammar doesn't shift — only the dynamic content. Receivers reading the interface see a grammatically-stable form regardless of how the address was rewritten en route.

## What's not decided

- The exact form of the address content: path-only, path+hash, URL+hash, hash-only — and when each is appropriate.
- How local-relative rewriting actually works in the serialization layer (who rewrites, when, based on what knowledge of the receiver).
- Whether any other dynamic-resolution content (version ranges, capability tokens, endpoint-dependent values) needs to live in interface docs — and if so, whether it shares the backtick delimiter or earns its own.
- In-source syntax: inside a file that has `<DOM: (dom) *>`, a path-dependent projection `DOM.Element` already works without any sigil, because `DOM` is in scope. The backtick form is specifically for interface *documents*, which are a distinct surface from source code. Whether source ever needs the backtick form (e.g., interface declared outside any DI scope) is an open question.

## Rule, restated

- **Backticks** — dynamic content the system resolves/rewrites. Addresses in type position.
- **Quotes** (double or single, interchangeable) — static literal content. Match-value tags.
- **Parens** — reserved for parameter lists, tuple returns, type grouping.
- **Braces** — service/instance interface shape.
- **Angle brackets** — constructor param list; import declaration.
