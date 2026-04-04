# BVX Conclusions: In-Browser Brevity and XML as Alternative Constructor Call

## Executive Summary

This document captures the conclusions of an extended design session exploring whether Brevity — a novel actor-model programming language compiling to JavaScript — can serve as a web development environment, and whether XML/HTML syntax can serve as an alternative constructor invocation syntax within the language. The central finding is that **there is no need for a separate "BVX" format**. Brevity's existing constructor syntax, designed with angle brackets, already unifies with XML semantics. The web development story falls out naturally from existing language primitives rather than requiring a separate templating layer.

---

## Part 1: The Case for Brevity in the Browser

### The Core Insight

Modern web UI development has accumulated enormous accidental complexity around what is fundamentally a communication problem. React's prop drilling, Redux's action/reducer/selector ceremony, pub/sub systems, context providers, and signal graphs are all workarounds for the fact that Component A needs to tell Component B something, and the framework doesn't provide a natural way to do so.

CAM's "everything has an address, just send it a message" collapses all of that into one uniform primitive. DOM elements as actors — entities that own their own state, respond to messages, and communicate bidirectionally with their surroundings — represents a fundamentally different relationship than the tree-of-puppets model used by React, Vue, and similar frameworks.

### Differentiators Over React

**Uniform semantics from element to system.** In React, a `<div>` and a `<MyComponent>` are fundamentally different things pretending to be the same thing. In BVX, everything is an actor. A div with a click handler and a complex stateful widget are the same kind of thing at different points on a complexity spectrum.

**State is owned, not managed.** React externalized state management because its own model couldn't handle it — hence Redux, Zustand, Jotai, Recoil, signals libraries, and the endless churn. In Brevity, every actor owns its state as ref cells and communicates state changes via messages.

**Communication topology is independent of DOM topology.** In React, sibling communication requires hoisting state, threading context, or reaching for global stores. In Brevity, any actor can message any other actor by address. A sidebar actor and a content pane actor just talk to each other. The DOM tree determines rendering layout and actor supervision, but not who can talk to whom.

**The static/dynamic boundary is visible.** React re-renders everything and then diffs. Brevity actors without mutable ref cells don't change, and the runtime knows this structurally. Only actors with mutable state update, and they update in response to specific messages.

**No virtual DOM.** Like Solid.js, Brevity compiles reactive bindings at the precompiler level. The ref cell knows its subscribers; the subscriber knows its DOM node. State changes, node updates. There is no intermediate virtual representation and no diffing pass.

### Compiler Footprint

The Brevity transpiler is ~14K lines of pure JavaScript with zero runtime dependencies. Only the JavaScript codegen target (~6,480 lines) would be bundled for browser use. Estimated size:

- ~70 KB minified
- ~20 KB gzipped

For context: TypeScript's compiler is ~10 MB, Babel core is ~800 KB, Svelte's compiler is ~200 KB. Brevity's compiler is smaller than most hero images.

There are no architectural blockers: the transpiler is a pure AST-to-code transform with no file I/O, no network calls, and no Node.js API dependencies in the compile path.

### Browser Runtime Requirements

Beyond the compiler, a browser deployment needs:

1. **A message dispatch scheduler** (~200 lines of JS estimated), mapping naturally onto the browser's existing event loop via microtasks.
2. **An actor registry** for address resolution, enabling actors to find each other by address strings.
3. **DOM-to-actor mapping**, handled by the `element` superclass hierarchy that translates actor lifecycle operations into DOM mutations.

---

## Part 2: Mounting and Progressive Enhancement

### The Script Tag Approach

The recommended embedding model uses standard HTML with two script tags:

```html
<html>
<head>
  <script src="brevity.js"></script>
  <script type="text/brevity" src="app.bv"></script>
</head>
<body>
</body>
</html>
```

`brevity.js` loads, fetches and compiles the `.bv` file, and attaches to `document.body`. No build step, no toolchain, one HTML file and one `.bv` source file.

### Custom Elements for Sprinkling Actors

For applications that enhance existing HTML rather than owning the full page, custom elements with the `bvx-` prefix provide actor mount points:

```html
<body>
  <bvx-counter></bvx-counter>
  <bvx-clicker>Click me</bvx-clicker>
</body>
```

`brevity.js` registers custom elements for exported constructors in the `.bv` file. The browser handles custom element lifecycle — insertion, removal, attribute changes — all with built-in hooks.

### Progressive Enhancement

Custom elements render their HTML content normally before JavaScript upgrades them. Pre-existing children display instantly as static HTML, then actors take over once the runtime loads. CSS supports this transition natively:

```css
bvx-counter:not(:defined) { /* before JS loads */ }
bvx-counter:defined { /* after upgrade */ }
```

This achieves the same progressive enhancement as server-side rendering with hydration, without requiring a server-side rendering step.

### Two Modes That Compose

These two approaches compose naturally. The `document.body` mount handles the case where Brevity owns the whole page. The `<bvx-*>` elements handle the case where actors are sprinkled into existing HTML. Both use the same runtime and the same `.bv` source file.

---

## Part 3: Addressing and CAM Congruence

### Contextual Address Resolution

The same messaging syntax works across all deployment contexts:

- `"#counter".increment` — DOM address resolution
- `"/remote".call(...)` — file tree address resolution
- `"cam://host/path".call(...)` — network address resolution

The language has one concept: send a message to an address string. The runtime provides the lookup. This is the "Contextual" in Contextual Actor Model — an address means what the environment says it means.

### Dependency Injection

The browser runtime provides DOM capabilities through constructor dependency injection:

```
<DOM: (dom) *, body: *>

<<body> id: Text, title: Text> {
  ...
}
```

This ensures BVX apps are portable and testable by construction. The browser runtime injects real DOM constructors; a test harness injects mocks; a server-side renderer injects HTML string emitters. The app doesn't know or care.

---

## Part 4: XML as Alternative Constructor Invocation Syntax

### The Unification

Brevity's angle bracket constructor syntax was designed to echo HTML tags. The realization from this design session is that this echo is not merely cosmetic — it is semantic identity. XML element instantiation and Brevity constructor invocation are the same operation:

```
t = T(100)
t = <T 100 />
```

These are the same call. The angle bracket form is an alternative invocation syntax for constructors, not a separate template language.

### Three Disambiguation Rules

The parser distinguishes three uses of angle brackets by what follows the opening `<`:

1. **`<ClassName ...>`** — Name first: constructor invocation. Open tag, expects children and a closing tag.
2. **`<ClassName ... />`** — Name first, self-closing: invocation with no children.
3. **`<params...>`** — Type declarations first: constructor definition header.

The first token inside the angle brackets determines which production the parser enters. No lookahead beyond the first meaningful token is required.

### Child Accumulation

Inside an XML-style parent element, children are accumulated implicitly — this is inherent to XML semantics:

```
<div>
  <p>first</p>
  <p>second</p>
</div>
```

This differs from BV block return semantics (where only the last expression is evaluated) and is a deliberate contextual difference. The XML form earns its keep precisely because child accumulation is the natural, expected behavior in a template.

For top-level fragments without a parent, the empty tag fragment syntax `<>...</>` serves as a grouping mechanism, consistent with React's fragment syntax.

### Inline Text, Interpolation, and Code

Inside XML tag children, three modes apply:

- `<` starts a child element
- `{ }` starts a Brevity expression (interpolation or code)
- Everything else is plain text

```
<div>
  <h1>Hello, world.</h1>
  <p>Your count is { count }.</p>
  <p>{ complex_expression(args) }</p>
</div>
```

This matches HTML's familiar model. Curly braces are the escape hatch into Brevity.

### Event Handlers: String vs. Brevity

The distinction between JavaScript passthrough and Brevity expressions follows JSX conventions:

- **Quoted string**: passed through as raw JavaScript. `onclick="alert('hi')"` — the developer's responsibility.
- **Curly braces or Brevity syntax tokens** (`{ }`, `->`, `|`): parsed as Brevity expressions. `click={ -> counter.increment }` or `click= -> counter.increment` — compiled by the precompiler.

### Singleton Elements

For elements used exactly once, inline code in the opening tag creates a singleton actor — defined and instantiated in one expression:

```
<div
  count *Integer = 0
  @increment = { count <- count + 1 }
>
  <p>{ count }</p>
</div>
```

The logic lives in the attributes area of the opening tag (before `>`). Children live between the tags. The verbosity scales with the complexity of the behavior.

### Mixing BV and XML Freely

BV and XML syntax can interleave without ceremony because they compile to the same underlying constructors:

```
<div>
  <h1>{ title }</h1>
  { complex_thing(param1, param2) }
  <p>{ description }</p>
</div>
```

XML where it reads well. BV in curly braces where XML would be awkward. The compiler doesn't care which surface produced the constructor call.

---

## Part 5: The `yield` Keyword

### Discovery

The design session explored how an `element` superclass should capture the template output of a child class's init body. Multiple approaches were considered and rejected:

- **`render()` function call**: Adds a concept without adding capability over implicit capture.
- **`init_result` lifecycle hook**: Novel, no prior art, hard to explain.
- **Setter on a well-known property** (`set::body`): Works but adds indirection.
- **Interceptor pattern**: Complex, over-engineered.

The solution is `yield` — a single keyword that allows a superclass to pause its construction, delegate to the child class's init body, and capture whatever value the child returns:

```
element = <<HTMLElement> tag Text> {
  dom = yield
  attach(dom)
}

Card = <<element> tag="div"> {
  count *Integer = 0
  @increment = { count <- count + 1 }

  <div>
    <h1>{ title }</h1>
    <p>{ count }</p>
  </div>
}
```

### Why This Works

`yield` is sound specifically because construction has a guaranteed calling order that regular method dispatch does not. The parent init always runs first, unconditionally. The parent can confidently yield knowing the child will run next. This precondition does not exist for regular method calls, so `yield` is construction-only.

### Why This Isn't Standard OOP

OOP assumes construction flows in one direction: the subclass calls `super()`, each layer initializes itself and returns. The superclass is complete before the subclass begins (Dependency Inversion Principle).

`yield` inverts the second half: the superclass initializes partway, hands control down to the child, receives a result, and finishes. The control flow is up-down-up instead of just up-then-back-down.

This doesn't create fragile base classes because the superclass doesn't know what the child will produce — only that it will receive something. The contract is open.

### What It Unlocks Beyond DOM

- **Declarative middleware**: Any superclass can define a processing pipeline where the child provides the payload. A serialization superclass yields and gets a data structure. A permissions superclass yields and gets a capability set. An API endpoint superclass yields and gets a response body.
- **Composable construction phases**: Chained inheritance where each layer yields, transforms, and passes up.
- **DSL containers**: A superclass that sets up an environment before yield, letting the child operate in that context.
- **Supervision patterns**: Analogous to Erlang's supervision model expressed as a language primitive.

### Graceful Degradation

If a superclass does not yield, construction behaves like normal OOP. The child's init body runs, builds up `self`, and `self` is returned. `yield` is opt-in by the superclass. If never used, the language behaves conventionally.

---

## Part 6: Reactive Ref Cells

### Intrinsic Reactivity

All `*` ref cells are intrinsically reactive. They track their readers and notify on write. This is not a DOM-specific feature — it is a property of the ref cell primitive itself.

For scalar types (Integer, Text, Boolean, Float), auto-emission on write is implicit. No `emit` declaration is needed. For complex types (arrays, keymaps, structures), explicit `emit` declarations allow the actor to define what constitutes a meaningful change.

### How Templates Bind

The precompiler sees `{ count }` in a template and knows `count` is a ref cell. Instead of emitting code that reads the value immediately, it emits a thunk — a closure that holds a reference to the ref cell itself. The `element` superclass evaluates these thunks inside a tracking scope. The ref cell records the dependency. On write, it notifies subscribers, which update specific DOM nodes.

The developer writes `{ count }`. The precompiler wires the tracking. The ref cell does the notification. The element superclass does the DOM mutation. No virtual DOM, no diffing, no re-rendering.

### Connection to Existing `emit`/`on` Pattern

Brevity already has `emit` for custom events and `on` for subscribing. Ref cell auto-emission on write is a natural extension: the existing `on` syntax works for subscribing to state changes. The subscriber doesn't know or care whether the event was an explicit `emit` or a ref cell change.

---

## Part 7: Visibility Tiers

### Three-Tier Model

The design session settled on three visibility levels for actor members:

- **`@` (public)**: Accessible by anyone via dot access. Part of the actor's external interface.
- **No sigil (protected)**: Accessible by the actor and its child classes. Family business, not public API.
- **`#` (private)**: Hard wall. Only accessible by the defining actor, not even children.

### JavaScript Compilation

- `@` public → regular class methods/properties
- Bare protected → regular class methods/properties with compiler-enforced visibility
- `#` private → JavaScript `#` private fields, enforced by the engine at the syntax level

The `#` sigil maps directly to JavaScript's native private field syntax with identical semantics. The alignment was intentional.

### Calling Conventions

From outside an actor: `actor.method()` calls the `@` public method (the `@` is elided in dot access).

From a child class: bare `method()` resolves on self through inheritance, reaching protected methods on the parent. The asymmetry is meaningful and visible — explicit receiver means public interface, bare call means family access.

An escape hatch for calling a parent's protected method when the child has overridden it (analogous to `super`) remains an open design question.

---

## Part 8: Constructor Syntax — Single vs. Double Angle Brackets

### The Consideration

The session explored using `<<>>` for constructor definitions to visually distinguish them from `<>` invocations:

```
Counter = <<count Integer>> { ... }    // definition
<Counter count=0 />                     // invocation
```

Double brackets carry a connotation of a second level of indirection — a constructor is a thing that produces things, one step removed from direct instantiation.

### Decision: Remain With Single Brackets

After exploration, the conclusion favors single angle brackets for definitions. The reasons:

- Immutable type declarations are cleaner: `Point = <x Integer, y Integer>`
- DI headers are cleaner: `<DOM: (dom) *>`
- The subclass form `<<superclass> ...params>` already works and represents nesting, not a doubled delimiter
- Context already disambiguates definition from invocation (assignment context vs. inline usage)
- Double brackets visually resemble heredocs or comments

### Closure Rules

Angle brackets default to closed (no body) unless explicitly followed by:

- A curly-brace block `{ }`
- A return arrow `->` supplying a single expression
- In lineal form, an equals sign on its own line (its accidental omission will error loudly)

The common case — simple types and singletons — requires no ceremony.

---

## Part 9: The Central Conclusion

### There Is No BVX

The angle bracket constructor syntax is already XML-compatible. Constructor invocation and element instantiation are the same operation. A `.bv` file that defines element constructors and instantiates them is already a web application.

There is no separate template language, no `.bvx` file extension, no mode switching, no JSX-like preprocessor. One language, one file type, one parser, one compiler.

This is not a simplification achieved by cutting corners. It is a consequence of:

- Designing constructor syntax with angle brackets
- Making actors the universal primitive
- Giving ref cells intrinsic reactivity
- Providing `yield` for the superclass-captures-template pattern
- Contextual address resolution via CAM

Every design decision converges on this: there is no gap between the language and the markup because they were always the same thing.

**No BVX. Just BV.**
