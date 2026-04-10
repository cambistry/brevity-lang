# Plan: defining the `template` type

## Context

Target script:

```
<script type="text/brevity">
  t = <template | :text Text> {
    <div class="top">
      { text }
    </div>
  }
  el = <t text="CONTENT" />
  document.body().append!(el)
</script>
```

Intended semantics:
- `template` is auto-DI'd
- `t` is a subtype of `template`, extended with a `text` parameter
- The injected `div` constructor builds an element whose children list is `["CONTENT"]`
- The constructed `<div>` is returned from the subtype body and captured by `template` via `ingest`
- `template` then "becomes" that compiled structure

## What's already in place

From the parser, ingest tests, and `notes/bvx-constructor-design-2026-04-02.md`:

- **`ingest`** works as documented: supertype declares `field Type = ingest` (or `ingest(default)`), construction suspends, subtype declaration body runs, its `-> value` is bound into the field, supertype resumes. Type-checked at the subtype site. (`__tests__/keywords/ingest.md`, `__tests__/constructors/ingest.md`)
- **`<Base | :extra Type>`** subtype-with-extension is implemented: new params union with inherited params, override of an inherited param's type is a compile error. Stored in `supertypes` on the actor node. This matches the script syntax — not the `<<base>>` form from the 04-02 note.
- **XML instantiation** `<t text="CONTENT" />` already desugars to a constructor call with named args. (`src/parser.js:1202-1240`)
- **`!` mutation suffix** is just lexed onto the method name; convention only, no special semantics. (`src/parser.js:1343-1346`)
- **`as Type`** is a compile-time attestation, no runtime effect.
- **DI** is per-file via the `< ... >` header at the top of a `.bv` file (with `<:document *>` shorthand). There's no implicit lexical-walk-the-actor-tree resolution today.
- **Browser target**: JS codegen + a runtime that runs `<script type="text/brevity">`; DOM elements are actors; `document.body()` exposes `append!`. (`notes/browser-target-2026-04-01.md`)

Out of scope (per Chris): the `<div class="top"> { text } </div>` children mechanism. Plan is built so it plugs in later without touching `template`.

## Two facts confirmed before writing the plan

- **No catch-all handler** in the parser — in-language transparent forwarding (`@_ = |msg| -> root.send(msg)`) is not viable today. Grepped `src/` for `@_`, `catchAll`, `catch_all`, `forward.*message`, `wildcard.*handler` — nothing.
- **Subtype-body return is explicit `-> value`**, stored as `declarationReturn` on the actor AST (`src/parser.js:3487-3490`, `src/codegen/javascript/classes.js:667-671`). The example as written has no `->`, which means either implicit-last-expression (a small parser change) or the body needs `-> <div ...>...`.

## The actual design question

It collapses to one thing:

**When you write `el = <t text="CONTENT" />`, what kind of actor is `el`?**

The next line is `document.body().append!(el)` — `append!` takes an *element*. So either `el` IS an element, or `template` has to make it look like one.

Three candidates:

### A. `el` is a `t` instance with the div held in a `root` field

- `template` is a normal Brevity actor: `template = <> { root = ingest; ... }`
- `t` (the subtype) inherits from template, so `el` is a `t`.
- `append!(el)` then has a problem: `el` is a `t`, not an element. It would have to forward messages to `root`.
- **In-language forwarding requires a catch-all handler**, which doesn't exist in the parser. So this option means *also* introducing `@_ = |msg| -> root.send(msg)` (or similar).
- **Verdict:** viable but adds a second new feature (catch-all). Larger surface than the rest of the plan.

### B. `el` IS the captured div — `template` is transparent, yields its ingest

- The `t` instance's lifetime is just "run my body, return what I built." There's no persistent `t` wrapper around the div.
- `append!(el)` Just Works because `el` is, observably, a div.
- This requires a primitive that doesn't exist today: **a supertype whose construction returns the ingested value as the constructed actor**, instead of returning `self`.
- Two ways to introduce it:
  - **B1 — `template` is a built-in** with a compiler flag "yields-its-ingest." Smallest possible language change: one annotated intrinsic, no new syntax. The Brevity-level definition is essentially `template = <> { root Element = ingest }`, plus the flag.
  - **B2 — General primitive**: any supertype whose declaration body ends with `-> :ingestField` is treated as yielding that field as the constructed actor. More honest, reusable for non-template factories, but it's a real semantic addition (constructors can now return-other-actor, à la Python `__new__`).

### C. Template exposes `mount!` instead of being passable to `append!`

- `t(text: "CONTENT").mount!(document.body())`. Doesn't match the example. Out.

## Recommendation: B1 now, with B2 as the "if we generalize"

`template` becomes a built-in registered alongside `document`:

```brevity
template = <> {
  root Element = ingest
}
```

…plus a single flag on the actor node — `yieldsIngest: true` or similar — that the JS codegen reads. When constructing an actor whose chain includes a `yieldsIngest` supertype, the constructor returns the ingested value rather than `self`. Everything else (subtype params, ingest type checking, XML call sugar) is reused unchanged.

Why B1 over B2:
- Touches one built-in + one codegen branch. No new syntax, no parser change for the construct itself.
- Doesn't commit you to "any supertype can yield its ingest" until you've seen a second use case.
- B2 stays open: if a second `template`-like type appears, promote the flag into a language-level form.

Why B1 over A:
- A needs a catch-all handler primitive, which is a separate language feature with its own design surface (pattern shape, dispatch order vs. typed handlers, performance). B1 needs one boolean on a built-in.

## Concrete steps

1. **Decide implicit-vs-explicit declaration return.** The example body has no `->`. Today, `declarationReturn` is only set when the body ends with an explicit `-> expr` (`src/parser.js:3487-3490`). Two paths:
   - (a) Change the example to `{ -> <div ...>...</div> }` and ship template now.
   - (b) Add implicit-last-expression-as-return to `parseActorBody`. Small parser change, but it's a semantic shift (every existing actor body would suddenly have a return value). Take (a) for now and revisit (b) as a separate decision.

2. **Pick the ingest type.** `Element` is the right name long-term. If there's no `Element` supertype yet, use `Any` as a placeholder and tighten when the element hierarchy lands alongside the children feature (#3). This keeps the public interface stable.

3. **Add `template` as a built-in.** Same registration path used for `document` / other ambient services. Definition body is just `root Element = ingest` (or `Any`); annotate the AST with the yields-ingest flag.

4. **Codegen branch.** In `src/codegen/javascript/classes.js`, where the constructor wires up `inheritedIngests` and `declarationReturn` (lines 667-700, already in the file), add: if any supertype in the chain is `yieldsIngest`, the generated constructor returns the ingested value instead of `this`. Mirror in `src/codegen/erlang/program.js` and `src/codegen/rust/program.js` only when those targets need browser/DOM support — JS first.

5. **Tests** (mirroring `__tests__/constructors/ingest.test.js`):
   - `template` cannot be instantiated directly — must be subtyped. (Same error path as ingest-without-default.)
   - A subtype with `:text Text` and a body returning a div produces a div when instantiated, not a `t`.
   - The yielded actor responds to element messages (e.g. `append!`).
   - Two `<t text="A" />` and `<t text="B" />` calls produce independent element instances.
   - Type mismatch: subtype returns a non-Element → compile error at the subtype site (already wired by ingest's existing type check, just verify it fires).

6. **Don't touch element children.** When the children feature lands, `<div>{ text }</div>` will produce a div whose children list contains `text`, and template doesn't need any change — it just ingests whatever the body returns.

## Open questions worth a quick answer before code

- **Catch-all handler** — does it exist anywhere missed (lexer? validate.js?)? If yes, A is back on the table and might be cleaner. Grep of `src/` came up empty.
- **Element supertype** — does one exist, or are `div` / `p` / `body` sibling actors with no shared interface? Affects whether step 2 picks `Element` or `Any`.
- **Param binding inside the body** — `:text Text` declares the param; existing ingest tests reach it as `:label`, the example uses bare `text`. Pin down before writing tests.
- **DI for the script** — does `<script type="text/brevity">` autoinject `template`, or does the script need a `<:template *>` line? Probably the former (it's an intrinsic), but worth being explicit.
