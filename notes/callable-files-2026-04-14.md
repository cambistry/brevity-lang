# Callable files: tail-return at the file-constructor level (2026-04-14)

Follow-up to `self-becomes-2026-04-14.md`. That note established tail-return as "self becomes" — the wrapping actor's address resolves to the tail expression's value at call boundaries. This note records a specific and important application: when tail-return is applied at the file-constructor level, the file itself becomes directly callable.

## The motivating case

A file wants to expose a single constructor — a template, a factory, a function. Without tail-return at the file level, you're forced into the nested form:

```brevity
// factory.bv
<HTML: (:p) *>
=
@Template
<:content Text>
=
->
<p>{ content }</p>
```

Caller:
```brevity
<"factory.bv": Factory *> {
  widget = Factory.Template(content: "Hello!")
}
```

`Factory.Template(...)` reads redundantly when Factory's entire job is to hold Template. The nesting earns its keep when there are multiple inner constructors sharing imports; it's dead weight when there's exactly one.

## The move

Apply tail-return at the file constructor's body. The file's tail expression is itself a constructor (or function literal), and the file's instance *becomes* that constructor/function at call boundaries.

### Case 1: file becomes a constructor

```brevity
// factory.bv
<HTML: (:p) *> {
  <:content Text>
  ->
  <p>{ content }</p>
}
```

Caller:
```brevity
<"factory.bv": Factory *> {
  widget = Factory(content: "Hello!")
}
```

`Factory(...)` calls the projected constructor directly. No `@Template` intermediate, no naming redundancy. The file's body contains an inline anonymous constructor `<:content Text> -> <p>{content}</p>`; per the tail-return rule, the file's instance resolves to this constructor at call sites that invoke it.

### Case 2: file becomes a function

```brevity
// function.bv
<> {
  |params| { output }
}
```

Caller:
```brevity
<:"function.bv"> {
  result = "function.bv"(params)
}
```

No explicit `->` is needed — the file's body is a single bare expression (`|params| { output }`), which is the implicit tail return per the rule in `implicit-return-refinements-2026-04-14.md`. The file becomes a callable function literal.

**The `<:"function.bv">` import syntax is experimental.** Chris is trying out a form where a path string imports the file and binds it to the path string as an identifier at call sites. Clever but awkward in practice (path strings as identifiers, quoting everywhere). Conventional form is `<"function.bv": fn *>` with an explicit alias. No commitment yet; see Open Questions.

## Why this is good, not just terse

1. **No new mechanism.** Tail-return is already the rule; this note confirms it applies to file-level constructors recursively. No new primitive, no new keyword.

2. **Staged construction falls out naturally.** Outer file params (imports, system dependencies) bind once at file load. Inner constructor/function params bind per call. This is effectively currying — `factory.bv :: HTML -> content -> <p>` — but Brevity doesn't have to introduce currying as a language feature. The staging is just "outer constructor params vs. inner constructor params," which is already how Brevity constructors compose.

3. **Explicit dependency flow is preserved.** HTML appears in the file's import list; `content` appears in the inner constructor's param list. Each dependency is visible at the call boundary where it binds. No auto-injection, no ambient authority. The functional-dependency principle (see the 2026-04-14 conversation and `self-becomes-2026-04-14.md`) is respected without ceremony.

4. **No naming redundancy.** `Factory.Template(...)` collapses to `Factory(...)`. The file's *role* as a template constructor is its identity; no intermediate name earns its keep.

5. **Retroactively explains the `self as Function` direction.** The morning's `notes/template-type-2026-04-10.md` framed templates as actors with a `self as Function` projection. Under tail-return, that framing is structural instead of projective: the file *becomes* a callable, no explicit `self as Function` clause required. The 04-10 framing was groping toward this same answer from the wrong direction. Both the template-as-constructor (Case 1) and the template-as-function (Case 2) variants fall out of the same mechanism, no special-casing needed for either.

## What's new syntactically

One thing needs to be pinned down before implementation:

**Inline anonymous constructors as expressions.** The file's body contains `<:content Text> -> <p>{content}</p>` — a constructor-shaped expression with no name. Brevity already supports named inner constructors (`@Template <...> = ...`); the move here is accepting *unnamed* constructor expressions in tail position. The grammar needs to accept constructor-shaped expressions as values, not just as declarations. Worth being explicit about so an implementer doesn't stumble on "wait, is this a declaration or an expression?"

Function literals (`|params| { output }`) are already expression-positioned, so Case 2 needs nothing new grammatically — just the tail-return rule applying at the file level.

## Trade-offs

- **Single-tail constraint.** One tail per file (consistent with "one return per block"). Files with multiple constructors to expose still need the nested `@Name <...> = ...` form. The inline tail-return is the economical special case for the common "one template per file" / "one function per file" shape; the nested form is the general case. They coexist without conflict.

- **Factory pattern still earns its keep when shared imports matter across multiple exposed constructors.** When you have several inner constructors sharing system dependencies (an HTML-importing file that exposes `@Template`, `@Button`, `@Modal`, etc.), the explicit nested form is still the right shape. Don't collapse to the inline form unless there's exactly one inner constructor.

## Open questions

1. **Experimental import syntax.** `<:"function.bv">` — importing a file by path with no alias and using the path string as the identifier. Worth deciding whether to support this or require an explicit alias. Path-strings-as-identifiers reads awkwardly at call sites (`"function.bv"(params)` has quoting noise), and it conflicts with the principle that identifiers are lexical, not path-structural. Lean toward requiring an alias for readability, but Chris is trying it out.

2. **Type-level description of "callable file."** When `factory.bv` is imported, what's the declared type of `Factory` in the import list? Is it a constructor type `(:content Text) -> <p>`, or something higher like "actor-projecting-as-constructor"? The caller's type system needs to know to route `Factory(...)` invocations to the projected inner constructor. Answering this is the same question as "how does the caller resolve the tail-return projection at the call site" — it falls out of whatever that mechanism is, and should be consistent across file-level and in-file tail-returns.

3. **Handlers alongside a tail function/constructor.** If a file becomes a function, can it also declare its own public handlers on the file actor? e.g., `@reset = ...` alongside a tail function literal. Presumably yes, consistent with the DOM/Para pattern — handlers are handled at the file actor's address; function-call-shaped invocations unwrap to the tail. Worth confirming, and worth considering whether there are collision cases between "calling the file" and "messaging a handler."

## Status

Design conversation 2026-04-14, afternoon. No implementation yet. Read after `self-becomes-2026-04-14.md`.

The `<:"function.bv">` import syntax is experimental and should not be treated as settled.
