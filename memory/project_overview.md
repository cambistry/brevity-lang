---
name: project_overview
description: Repo layout, the stack (Brevity, CAM, Binder, Bluster, topology), handler, CAM and Brevity-language basics
metadata:
  type: project
---

# Project Structure
- `threads/` — raw AI conversation threads (source material)
- `concepts/` — first-pass concept notes (written 2026-02-24)
- `syntax/` — language syntax notes (written 2026-02-24)
- `sources/` — API docs (Anthropic, OpenAI)

## The Stack (top to bottom)
1. **Brevity** — the language you write
2. **CAM actor tree** — how it runs (polyglot actors, JS objects at boundaries)
3. **Binder** — vertex-level chat/messaging protocol
4. **Bluster** — authenticated, content-addressed wire protocol
5. **Topology** — nodes, vertices, edges

### Handlers (see syntax/handlers.md)
- Declared at top-level scope of a file, no wrapper or export needed
- Evaluated in order, Elixir-style pattern matching
- Lineal form: ends at first blank line; delimited form: ends at `}`
- The file is the actor — no class or module boilerplate

## Key Concepts (see concepts/ for full notes)

### CAM Actor Model (Common Actor Model)
- Polyglot actor tree: each actor can be in a different language
- Actors communicate by passing vanilla JS objects (plain JSON-compatible)
- Tree hierarchy provides routing substrate; actors don't need to know their absolute address
- Messages travel up through parents, which rewrite return addresses (perspective-relative addressing)
- Actors are sequential (one message at a time)

### Brevity Language
- Constrained app-definition language (not general-purpose)
- NOT indentation-based — has two forms: lineal and delimited (freely mixable)
- Spacious: no parens on args, double-newline is significant block delimiter
- Dense: parens on args, curly braces for blocks
- `--` (stitch): double-dash alone on a line, visual separator, no semantic weight, keeps lineal block continuity
- `returns` keyword: declares return type, can appear in function header OR at tail (where it acts as block terminator)
- `//` line comments, `---` triple-dash opens/closes block comments
- Colon for type annotation, `?` for optional
- **Class** = source artifact: class header (`*(...)`) + constructor block (`{...}`), declared as `C = *(params) { constructor }`. Constructing a class produces an **actor** (pass-by-reference / address). Has methods, inheritance, actor lifecycle. Prefix `*` is the universal "actorize" sigil — same one used for value actorization (next).
- **Type** = portable shape declared `type Name (fields)` (2026-11-13; `::Name (…)` is now just a parse error). Constructing a type produces a **value** (pass-by-value). `::` reaches a type through an actor (`Service::Point`). See [type/class split](../notes/type-class-split-2026-04-25.md) and the [vocabulary refactor](../notes/vocabulary-refactor-2026-05-15.md).
- **Data primitives**: **Object** (linked-list of positional/named entries; protocol primitive for args/replies — replaces older "Structure" / "BV Structure" / "List" / "Dictionary" wording), **Map** (has (see link)
- Both type fields and named params use `name: Type` (post-colon, flipped 2026-05-10 — prefix-colon `:name Type` retired). Positional remains `name Type` (no colon) (see link)
- Scalars (`Integer`, `Text`, etc.) are the canonical Types — immutable, no independent actor identity
- Prefix `*` actorizes a Type's value into an actor: `*Point(1, 2)`, `*Integer(0)`. Postfix `!` form is deprecated per [capability sigils v1](../notes/capability-sigils-2026-05-06.md).
- No generics in v1 — use `of` keyword: `Signed of Person`, `List of String`
- Boundary types are state transitions, not wrappers (`Signed of X` changes capabilities/trust)
- Imports are header entries `"path.bv": Alias` (no parens around a single name, 2026-10-29), optionally `(ctor) -> *{ iface }`. DI injects an actor: "who can I talk to?", not "what can I build?" (see [DI model](project_brevity_file_model.md))
- Compile targets: JavaScript (with browser variant), Rust, Erlang
- **Everything is async.** No synchronous semantics anywhere — handler calls, ref reads/writes, and closure captures are all runtime-mediated message ops (see link)
- **`<-` is the `set` operator** — sends a `set` message. Uniform across local refs and remote actor fields: `count <- count + 1` and `el.field <- "new"` are the same operation under different routing (see link)
- `::` reaches a type through an actor: `Svc::Point`, `actor::X`, `A::B::X`; types belong to actors (class-level, shared by its actors), bare name on the wire (`. Class X`), no `#Type`. See [type keyword note](../notes/type-keyword-and-actor-scoped-types-2026-11-13.md)
