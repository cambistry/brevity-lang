# Docs Planning — 2026-03-27

## Goal
Generate language description docs in `docs/` for GitHub.
Lead with features, not philosophy. Build the philosophy section later.

## Existing state
`LANGUAGE_OVERVIEW.md` exists but spends too much time proselytizing.

## Top 5 features (ranked by interest/usefulness)

Arrived at jointly — CK's instincts about leading with the model,
Claude's emphasis on type-dispatch and dual syntax.

### 1. The actor tree (including file-is-actor and `@`)
The universe model. The file is an actor. `@` marks the public surface —
no class, no module, no export. `@` carries the full weight of encapsulation
in a language with none of the usual boilerplate. This is the entry point to
everything: the first sentence of any documentation.

### 2. All functions are async / self-send
The most consequential design decision. Every function call (including private
ones) routes through the actor's dispatch loop. Programmer experience: you
never think about async. Architectural payoff: actors become serializable
(function refs are string labels with explicit captured state → capture/hydrate
for free). Forward references also fall out of this.

### 3. Unified syntax across levels
Handler, function, constructor, lambda — all the same shape. This is genuinely
rare. Most actor languages have a clean message-handler story but then functions
and constructors are a completely different grammar. In Brevity they're congruent
at every level.

### 4. Type-dispatch on messages (bv-a)
Every message carries its type schema alongside the payload. Handlers are
selected by exact type match, not name alone. The type system and the dispatch
system are the same thing. This merges with the CAM/JSON wire protocol story —
the protocol carries type attestations, the runtime dispatches on them. Type
system = trust model = routing.

### 5. Dual syntax (lineal + delimited)
Two surface forms, identical AST, freely mixable within a file. Spacious
(lineal, double-newline delimited, no parens) for readability; dense (parens
and braces) for tight one-liners. Same handler shown both ways is immediately
demonstrable.

## What didn't make the cut (but belongs in feature docs)
- `constructs` / `emit` / `on` — impressive but a feature, not a concept
- `:` colon destructure sigil — good ergonomics, not top-5 conceptual
- Three-target polyglot compilation (JS/Erlang/Rust) — implementation
  achievement; document under actor model as a consequence
- Serializable actors (capture/hydrate) — document as payoff of #2
- `ref` cells / pass-by-reference — document in syntax reference

## Proposed doc structure
1. The actor tree (opens with file-is-actor, `@`, tree hierarchy)
2. Everything is async (self-send, what it means for writing code)
3. Unified syntax (handlers = functions = constructors = lambdas)
4. Type-dispatch (bv-a, wire protocol, type = trust = routing)
5. Dual syntax (lineal + delimited, show same handler both ways)
6. Feature reference (constructs, emit/on, ref, sigils, etc.)

---

## Beta readiness: what's missing

### Claude's assessment (ranked by "evaluator hits a wall")

1. **Custom type definitions** — `type` keyword reserved but parser doesn't
   consume it. Type-dispatch is a headline feature but users can't define their
   own types. Every handler spells out full parameter types inline.
2. **String operations** — Strings are inert. No interpolation, no escape
   sequences, no methods (length, slice, contains, split, join, trim). String
   concat works only by accident via JS `+`. Can't build a dynamic message.
3. **Source positions in error messages** — Lexer doesn't track line/column.
   Parser errors are generic with no location. First syntax error = dead end.
4. **Error handling** — Runtime errors crash the handler → generic `ex: error`
   reply. No user-level catch/recover. 416-line `catch` spec exists in
   `2 - features/CATCH.md` but zero implementation. Defensible as "errors are
   messages" for a beta if documented that way.
5. **Match/case expression** — No general pattern matching in function bodies.
   Type-dispatch at handler level only; value-based branching requires if/else.

Honorable mentions: general union types (only `Type | null`), list operations
(no length/filter/find/sort — must hand-roll with reduce), core math library.

### CK's assessment (ranked by design priority)

1. **Import/export for code reuse** — `uses` handles runtime wiring but doesn't
   solve code reuse. No mechanism to share definitions across files.
2. **Clarifying how types are declared and imported/exported** — The conceptual
   boundary between constructor and type isn't resolved. This is a design
   question that must be answered before syntax can be built.
3. **Hardening around core data types, especially strings** — Converges with
   Claude's #2.
4. **Predicate/inference pattern, especially as relates to crypto** — The
   boundary type system (Attestable → Signed → Ratified) and how the type
   system reasons about trust transitions. Not in the transpiler yet.
5. **Core common math library + thin wrapper of language-specific libraries** —
   Practical necessity for demos and real programs.
6. **Completing the `constructs` pattern** — Automatic importation of service
   manifests from remote actors.
7. **Compiler making dynamic calls during compilation** — Resolving import and
   type dependencies at compile time by querying the actor tree. Changes the
   compilation model fundamentally.

### Convergence

Both lists agree on: string hardening, type definitions, and multi-file
composition. The key difference is framing — Claude focused on syntax/tooling
gaps an evaluator hits immediately; CK focused on the deeper design problems
(type identity, compilation model, trust predicates) that must be resolved
to build those features correctly.

The type question is the linchpin: import/export, type declarations,
constructor/type boundary, and compile-time dependency resolution are all
one interconnected problem.

### Tooling note

CLI is being built separately as **Tensile** — already functional, catches
problems that don't surface in tests, has HTML-based UI capability. Tooling
is not a blocker for beta.
