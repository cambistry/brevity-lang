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

## Candidate thinning: `self as Function` (with implicit-return sugar)

**This is not a new primitive.** Brevity already has `self as` for declaring typed projections of an actor (`__tests__/keywords/self_as.md`). Examples in the doc include `self as Integer = -> 1` and `self as Text = -> "one"`. The mechanism we want for templates is just `self as Function` with the right target type — a use of `self as` that the language supports today, applied to a type Brevity hadn't had a use case for before.

**Explicit form:**

```
<DI> {
  self as Function = |params| -> { ... }
}
```

The actor declares a function-shaped projection. In contexts that want a callable, the actor IS that function. Coexists freely with `@`-prefixed handlers — same as the existing `Dual` example in the `self as` doc.

**Sugar (implicit-return rule):**

```
<DI> {
  -> (|params| -> { ... })
}
```

Generalized rule: whatever the declaration block returns is an implicit `self as T` clause where `T` is the returned expression's type (or the type it coerces into). Function-returning is one case; integer-returning, text-returning, element-returning are all the same rule. Chris's sketch:

```
C = <a Text> -> (-> "gimme a '{a}'")
c = C("hey!")
c() => "gimme a 'hey!'"
```

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

The file's body is a lineal function. The implicit-return rule makes it `self as Function returning Element`. The file is still an actor (DI flows through the constructor header, system-managed singleton remains addressable), it just *also* has a callable projection.

## The "either-or" question — already resolved by `self as`

I had earlier framed this as a trade-off:

> Not easy to have both. Either `c` is the addressable actor, or it is a function hosted by the actor.

That trade-off doesn't exist. The `self as` doc is explicit:

> An actor does not stop being an actor because it has `self as` clauses.

So a file with `self as Function = ...` AND `@named_handler` clauses has both surfaces simultaneously: function-shaped contexts call it, message-sending contexts message its named handlers, and the runtime dispatches based on what the surrounding code expects.

## Why this fits templates specifically

Templates have a natural function-shaped projection (params → element) and may also need named handlers for things like reactive updates from outside. `self as Function` gives them the callable surface; `@`-prefixed handlers stay available for everything else. Same actor, two surfaces, no compromise.

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

The mechanism is `self as Function` (existing), with the implicit-return rule as sugar over it. **Not a new primitive** — the language already has `self as`; templating is a use of it with a Function target type. This note supersedes the B1 plan in `template-type-2026-04-09.md`. No implementation work yet; the design is settling.

## Open threads

- The implicit-return-as-`self as` sugar rule is the only piece that's actually new. Worth deciding whether it generalizes to *every* return type (returning an Integer creates `self as Integer`, etc.) or whether it's restricted to Function. Generalizing is more honest but bigger surface.
- Per-element setter form `set @field = |val| { ref <- val }` declared inside an element opening (e.g. `<div content *Text = "initial" set @content = ...>`) is a new use of an existing keyword — `set` already exists for whole-actor setters. Field-level setters are the newer pattern.
- The `*` marker on a const declaration (`content *Text = "initial"`) signals mutability / accepts `set` — Chris noted he wasn't 100% sure about the exact syntax in that position. Worth pinning down before relying on it.
- Reactivity of `{ counter }` interpolation is bracketed but unsolved. Will need to be addressed before any complete templating story.
- Children-list mechanism for `<div>foo bar</div>` is still the next-step feature Chris flagged earlier.
