# Template type — function-returning constructors thread (2026-04-10)

Continues from `template-type-2026-04-09.md`. The B1 plan there (`template` as a built-in supertype with a `yieldsIngest` flag, ingest used as the templating mechanism) is **superseded**. The conversation moved to a different framing.

## How the framing shifted

Yesterday's framing leaned on `ingest` doing double duty: `template` was a built-in supertype, subtypes returned an element via the body, ingest captured it, and a special `yieldsIngest` flag made the constructed actor IS the captured element.

That was abandoned for two reasons:
1. It special-cases `template` with bespoke construction semantics.
2. It overloads `ingest`, whose real job is subtype→supertype value injection.

Replacement framing: **a template is just a function that returns a DOM element, invokable via XML form.** The language-level feature is XML-callable functions (proposed earlier in the thread). Templating is a use case of the function-call/element-construction story, not a separate type-system mechanism.

## Corrections to my model of the language

Several things I had wrong came out of this thread. Recording them so future me starts closer to the actual language model.

- **A `.bv` file is a constructor, not a loaded singleton.** It is compiled once but can be constructed many times, with different params each time. Each construction is an independent actor instance with its own state and address. "Loaded once" was wrong.
- **Two distinct addressing modes** for using a file:
  - **Caller-constructed**: `t = Counter(initial: 5)` makes an instance at `Counter/N`, with the caller responsible for any DI the constructor needs.
  - **System-managed singleton**: messaging the path `/counter.bv` directly. The system handles instantiation, including DI resolution from ambient context. This is the affordance templating wants.
- **DI lives in the file's `< ... >` constructor header** and gives you *constructor bindings*, not service references. `t = Thing(a: 5)` after `< "thing.bv": (Thing) <:a Integer> -> { ... } >` emits `::new` to the dep address; subsequent `t.method()` calls route to the returned instance address. (`__tests__/constructors/dependency_injection.test.js`)
- **The lineal `= params = body` shape is not a new envelope.** It's the existing lineal form for function/handler declarations (`LANGUAGE_OVERVIEW.md:113-121`). Using it at the top of a file would be a new *use* of an existing shape, not new syntax.
- **Private functions are `#`-prefixed**, public handlers are `@`-prefixed, bare names are local function values. (`__tests__/functions/index.md:18-22`)
- **Destructured op extraction in DI imports**: `<"widgets.bv": (:counter) *>` — `*` marks widgets.bv as an actor ref, the `(:counter)` parens destructure a specific op out of its interface for direct local binding. This is sugar; doesn't exist yet. Would expand to `<"widgets.bv": (Widgets) *>` + `Widgets.counter(...)` at the use site.

## The actual design question

Stated by Chris explicitly:

> How thin can the actor wrapper get for the common template case while still keeping the system-managed-DI affordance?

The constraint: the actor envelope has to stay (DI lives there, templates need DI for DOM). The question is how much surface boilerplate it costs in the common single-template case.

## Working baseline (verbose, uses only currently-plausible syntax)

```
widgets.bv:
<:DOM *>
=
@counter = |:initial Integer| {
  counter *Integer = 0
  <DOM.p @click = { counter <- counter + 1 }>{ counter }</DOM.p>
}
```

Caller:
```
<
  :document *
  "widgets.bv": (Widgets) *
>
=
el = <Widgets.counter initial={100} />
document.body().append!(el)
```

Notes:
- `el` is a **live actor ref of a DOM element**, not a value-typed description / vnode.
- Reactivity of `{ counter }` involves a subscription mechanism — bracketed off, not the current problem space.
- The handler returns the element; the caller mounts it. Composability stays open (a template can be embedded in another template's tree).

## Candidate thinning: function-returning constructors

Chris floated this:

```
C = <a Text> -> (-> "gimme a '{a}'")
c = C("hey!")
c() => "gimme a 'hey!'"
```

Mechanism: **if a constructor's declaration body returns a function, the constructed value IS that function, not an actor instance.** The function closes over the constructor's params and any DI'd actor refs. The actor "becomes" the function.

Applied to a template file:

```
counter.bv:
<:DOM *>
=
:initial Integer
=
counter *Integer = 0
<DOM.p @click = { counter <- counter + 1 }>{ counter }</DOM.p>
```

The file's body is a lineal function. The constructor returns it. The file's imported value IS the function. Caller writes `<counter initial={100} />` and dispatches directly — no `Widgets.counter` indirection because there's no second name to disambiguate.

## The trade-off Chris flagged

> Not easy to have both. Either `c` is the addressable actor, or it is a function hosted by the actor.

Function-shaped and actor-shaped (with named handlers) are mutually exclusive at the surface level. If the constructed value is a function, the actor identity collapses: no inbox to message, no place to add a second handler.

Reframing worth sitting with: **the trade-off is more about surface than runtime.** Even a function-returning constructor probably stays in the message-passing model under the hood — the closure captures actor refs (`DOM *`), and calling it emits messages to those refs whether you call it function or anonymous-handler actor. So the choice is whether the actor exposes *one nameless interface* (function-shaped) or *named handlers* (actor-shaped). "Addressable identity goes away" reduces to "the address has only one op, so why name it."

That reframing suggests a possible escape hatch: function-returning constructors *could* coexist with extra named handlers — bare `c()` hits the anonymous one, `c.other()` hits a named one. Probably not worth it for v1; the simplicity of "this file is one thing" is half the win.

## Why this fits templates specifically

Templates naturally don't have multiple meaningful operations — a template file IS one function. So function-shaped surface and template semantics align, and the either-or constraint isn't a loss in this case. Building the mechanism for templates first answers empirically whether the constraint feels limiting or freeing before it becomes a general language commitment.

## Design philosophy: DI honesty (ES modules vs. Brevity files)

An ES module is a singleton process, not abstract code. Closure semantics put each exported function's lexical home in the module record: calling `increment` from another file reaches into `counter.js`'s scope to read or mutate `count`, and the module hosts that state across all callers. The language doesn't *name* this — `import` looks like reading values — but the structure is there. Modules have identity, hosted state, hosted methods, and a one-time init lifecycle.

What ES modules are NOT is **actor-shaped**: they expose bindings rather than receiving messages, they have no addressable runtime identity you can pass around as a value, and they have no multi-instance affordance (singleton-by-default, no constructor pattern).

A Brevity `.bv` file has the same fundamental structure — stateful hosted singleton — but exposes the affordances ES leaves implicit:
- An **address** you can hand around (path-based for system-managed singletons, instance-based for caller-constructed instances).
- **Multi-instantiation**: `Thing(a: 5)` and `Thing(a: 7)` give you independent instances.
- A **choice of mode**: explicit construction vs. system-managed singleton, picked per use case rather than baked into the loader.

Templates want the singleton path (no reason to maintain N copies of a counter-template factory). Stateful instance-y things (db connections, sessions) want explicit construction. The choice moves from the module loader's defaults into the user's hands.

The honesty isn't "Brevity admits modules are actors." It's: **Brevity exposes the addressability, multi-instantiation, and mode-choice affordances that ES has the structure for but doesn't surface.**

This sidebar is the philosophical motivation for keeping the actor envelope around templates rather than collapsing them to free functions: the envelope is what makes the system-managed-DI affordance possible, and that affordance is exactly what ES modules paper over by always doing it implicitly.

## Status

Sitting with the function-returning-constructor idea. No implementation work yet. This note supersedes the B1 plan in `template-type-2026-04-09.md`.

Coexistence point worth recording: the function-shaped surface (`c()`) and the named-handler surface (`c.method()`) **can** live side by side on the same actor — the constructor's return value provides the function shape, additional `@`-handlers in the body provide named ops. Whether to use both at once is a per-file judgment call, not a language-level either-or.

## Open threads

- Does function-returning-constructor extend to all constructors, or only when there's a single returned function? What if the body returns a list, a record, an actor ref?
- If we go with this mechanism, what does the import side look like? The destructured shorthand `<"file.bv": (:fn) *>` might cover it, but the `*` marker meaning "actor ref" sits awkwardly when the imported value is a function.
- Reactivity of `{ counter }` interpolation is bracketed but unsolved. Will need to be addressed before any complete templating story.
- Children-list mechanism for `<div>foo bar</div>` is still the next-step feature Chris flagged earlier.
