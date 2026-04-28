# Identifier Namespaces — Pass 1 Plan — 2026-04-28

Three-namespace model for Brevity identifiers (bare / `@` / `#`), Pass 1.
Pass 1 fixes the existing `var` vs `@var` ref-cell collision and unlocks
`#`-actor properties in all three targets. Pass 2 (deferred) extends the
same lowering to local bindings, removes the `_pv_` band-aid, and drops
target-specific reserved-word handling.

Status: **specified**, not yet implemented. Tests TBD.

---

## Model

The sigil controls **external visibility** — wire surface and subclass
access — not internal scope rules.

| Sigil | Subclass access | Wire access |
|-------|-----------------|-------------|
| bare  | yes (protected) | no          |
| `@`   | yes (public)    | yes         |
| `#`   | no  (private)   | no          |

Internal rules are uniform across sigils:

| Action                          | bare | `@` | `#` |
|---------------------------------|------|-----|-----|
| Decl as actor property (ctor only) | ✓    | ✓   | ✓   |
| Read / send / mutate (anywhere) | ✓    | ✓   | ✓   |
| Decl as lexical local (anywhere) | ✓    | —   | —   |

Actor properties are declarable **only at constructor-statement level** —
not in handler bodies, not nested in `if` / `while` / lambdas. The bare
namespace alone has the additional "lexical local" mode (Pass 2 territory).

---

## AST canonicalization

Every binding-name string carries its sigil from parser through codegen.
Today the parser strips `@` from `RefDecl.name` (parser.js:2967); that's
the lone canonicalization defect that drives the rest of the work.

After Pass 1:

| Source             | AST `name`     |
|--------------------|----------------|
| `var Integer! = …` | `"var"`        |
| `@var Integer! = …`| `"@var"`       |
| `#var Integer! = …`| `"#var"`       |
| `var = expr`       | `"var"`        |
| `@var = expr`      | `"@var"`       |
| `#var = expr`      | `"#var"`       |
| `var` (read)       | `"var"`        |
| `@var` (read)      | `"@var"`       |
| `#var` (read)      | `"#var"`       |

`stateVarNames` becomes a single set keyed by full sigiled names.
Identifier resolution: name in the set → state lookup; otherwise → local.
No string-stripping anywhere.

---

## Per-target storage-key scheme

All three sigils get distinct, prefix-namespaced storage keys. Codegen-
internal helpers get a fourth, dedicated `__` prefix.

| Sigil    | JS class field         | Erlang state key | Rust state map key |
|----------|------------------------|------------------|--------------------|
| bare     | `this.#b_<name>`       | `state_b_<name>` | `"b_<name>"`       |
| `@var`   | `this.#a_<name>`       | `state_a_<name>` | `"a_<name>"`       |
| `#var`   | `this.#h_<name>`       | `state_h_<name>` | `"h_<name>"`       |
| codegen  | `this.#__<…>` / `_<…>` | `__<…>`          | `"__<…>"` / `_<…>` |

The four shapes are exhaustive and disjoint — any identifier in generated
output is exactly one of them, and the rule is greppable.

---

## Parser changes

1. **parser.js:2967** — public ref cell `@name Type! = expr`:
   change `AST.refDecl(op, typeName, value)` to
   `AST.refDecl('@' + op, typeName, value)`.

2. **`#`-actor properties at constructor scope** — extend the
   constructor-body parser to accept the same three forms the bare and
   `@` namespaces accept:
   - `#name Type! = expr` — private ref cell
   - `#name = expr` — private constant / typed immutable / function value
   - `#name = TypeName!(args)` — private cell-wrapped immutable
   - `#name = ActorClass(...)` — private actor instance

   Today `#name = …` at constructor scope is parsed via the private-
   function path only. That path becomes one branch of a sigil-aware
   constructor-statement parser; the other branches mirror what bare and
   `@` already do.

3. **Reject `#`-decls outside constructor scope** — parser already does
   this implicitly for many forms; make it an explicit error with a
   clear message at the entry points (handler-body parser, nested-block
   parser, lambda-body parser).

4. **`stateVarDecls` construction (parser.js:4080–4099)** — no logic
   change; `stmt.name` now carries the sigil end-to-end automatically.

5. **Synthesized getter/setter for `@`-refs (parser.js:2968–2983)** —
   the synthesized `@val` getter and `set@val` setter currently reference
   the (previously bare) state slot. Their bodies need to read/write
   `'@val'` instead of `'val'`. The wire op strings stay `"@val"` and
   `"set@val"` — those are protocol surface, unchanged.

---

## Validator changes

The duplicate-name check already does string equality on `stateVarDecls`.
Once the sigil is preserved, `val` and `@val` and `#val` become three
distinct entries, and the existing `@val + @val` rejection still fires
on real duplicates within one namespace. The bare-vs-`@` false-allow
goes away as a side effect — no validator change needed.

Add explicit validations:

- Reject `#`-property declaration outside constructor-statement scope
  (also enforced in parser; validator catches the cases that slip
  through).
- Reject duplicate names within a sigil namespace (already covered).
- Allow same-name across sigils (e.g., `val` + `@val` + `#val` together).

---

## Codegen changes — common shape

Every target needs three small edits:

1. **`stateVarNames` / `stateVarTypeEnv` keying** — keys carry the sigil.
2. **A central `stateKey(name)` lowering** — emits `b_/a_/h_` prefix
   based on the leading sigil. Replaces the ad-hoc string handling.
3. **Drop all `replace(/^@/, '')` calls** at RefRead/Identifier sites.

`Identifier` resolution becomes:

```
if (stateVarNames.has(name)) emit stateRead(stateKey(name))
else emit local(name)
```

`RefRead` resolution likewise — no special-casing the leading `@`.

---

## Codegen changes — JavaScript

**Files:** `src/codegen/javascript/classes.js`, `expressions.js`, possibly
`statements.js`.

- **Class field declarations** (currently emits `#val` once when both
  `val` and `@val` happen to collide): emit one declaration per sigiled
  name, using `#b_/`#a_/`#h_` prefixes.
- **expressions.js:8** — `jsIdent` keeps its `_pv_` rule for now (Pass 2
  removes it). Add a new `stateKey(name)` helper that returns `b_/a_/h_`
  + bare basename.
- **expressions.js:312–313** — `Identifier` and `RefRead`:
  ```js
  // Identifier
  return ctx.stateVarNames.has(expr.name)
    ? `this.#${stateKey(expr.name)}`
    : ssaResolve(ctx, expr.name);
  // RefRead — same, no @ stripping
  return ctx.stateVarNames.has(expr.name)
    ? `this.#${stateKey(expr.name)}`
    : `${jsIdent(expr.name)}.value`;
  ```
- **All other `this.#${name}` sites** (~25 in expressions.js, more in
  classes.js): route through `stateKey(name)`.
- **Snapshot/restore** (the `_takeSnapshot` / `_loadSnapshot` paths,
  currently emitting duplicate `val` keys): use sigiled names as
  snapshot keys. Determine: does snapshot wire compatibility need
  preserved bare names? If yes, snapshot keys stay sigiled at the
  Brevity level and only lower at storage. Most likely fine — snapshots
  aren't a stable external format.

---

## Codegen changes — Erlang

**Files:** `src/codegen/erlang/expressions.js`, `program.js`,
`preambles.js`.

- **preambles.js:1019 `erlStateKey`** — switch from `state_<name>` to
  `state_<prefix>_<name>` with prefix `b/a/h` based on leading sigil.
  Strip the sigil only here.
- **expressions.js:25, 58, 391–398** — drop the `bare = name.replace(/^@/, '')`
  pattern. Pass full sigiled name to `erlStateKey`, let it do the
  prefix lowering.
- **program.js:556, 1143** — same: `erlStateKey(ctx, p.name)` with
  sigiled `p.name`.
- **Snapshot map** (currently `#{<<"val">> => …, <<"val">> => …}`):
  keys become `<<"b_val">> / <<"a_val">> / <<"h_val">>` or sigiled
  Brevity names — same call as JS snapshot decision.
- **Cell-subs map keys** (`{cell_subs, <<"val">>}`): subscribe targets
  the *Brevity-visible* name, which is `@val` on the wire. The internal
  cell-subs key should reflect the wire identity, not the storage prefix
  — keep it `<<"val">>` (wire form) or migrate to `<<"@val">>` for
  clarity. Decide before patching.

---

## Codegen changes — Rust

**Files:** `src/codegen/rust/types.js`, `expressions.js`, `statements.js`,
`program.js`.

- **types.js:422 `stateKey`** — extend to apply `b_/a_/h_` prefix based
  on leading sigil before applying `childStatePrefix`. Order:
  ```
  prefix = sigilPrefix(name)        // b/a/h
  bare   = name without leading @/#
  if (childStatePrefix && !childConstructorParams.has(name))
    return `${childStatePrefix}_${prefix}_${bare}`
  return `${prefix}_${bare}`
  ```
- **expressions.js:76, 410, 412–414** — drop `replace(/^@/, '')`. Pass
  sigiled names to `stateKey`.
- **All `self.state.get("...")` / `self.state.insert("...")` sites** —
  route through `stateKey`. Inventory: ~15 sites across expressions.js,
  statements.js, program.js, handlers.js.
- **`childConstructorParams`** — set membership uses sigiled name; bare
  ctor params stay unprefixed-by-child as today, just with the new
  `b_` lead.

---

## Synthesized-helper hygiene

While in the codegen, rename internal helpers to a `__` prefix.
Mechanical, no semantic change.

| Today                          | After                                |
|--------------------------------|--------------------------------------|
| `set@val_fn` (Erlang)          | `__set_at_val_fn` or similar         |
| `priv_set@val_0` (Erlang)      | `__priv_set_at_val_0`                |
| `_cap_<lambda>_<var>` (JS)     | `__cap_<lambda>_<var>`               |
| `cell_subs`, `pending_subscribe` (Erlang dict keys) | `__cell_subs`, `__pending_subscribe` |
| `_takeSnapshot` / `_loadSnapshot` (JS) | `__takeSnapshot` / `__loadSnapshot` (only if not a public surface) |
| `_handle` (JS) | likely public, **leave alone** |

Audit each: anything **not** a public surface (host-callable or wire-
adjacent) gets `__`. Public surfaces stay as-is.

---

## Test impact

- **Behavioral tests** — should pass unchanged. Semantics are identical
  apart from the new `var + @var` legality and the new `#`-property
  forms.
- **Compiled-output assertions** — any test that asserts on storage
  keys, snapshot map shapes, or generated identifier names needs
  updating. Inventory before patching: grep `__tests__` for `state_`,
  `this.#`, `\.state\.get\("` patterns. Expect a few dozen hits.
- **New positive tests:**
  - `val Integer!` + `@val Integer!` coexist with independent values.
  - `#val Integer!` ref cell at constructor scope (read, mutate).
  - `#val = expr` private constant (read).
  - `#val = ActorClass(...)` private actor instance (send messages).
  - All three sigils declared together, all readable, no aliasing.
- **New negative tests:**
  - `#val Integer! = 0` inside a handler body → compile error.
  - `#val = …` inside `if`/`while`/lambda body → compile error.
  - Duplicate within sigil (`@val Integer! = 0` twice) still rejected.

---

## Deferred to Pass 2

- **Local-name lowering to `b_<name>`** — eliminates the `_pv_` rule
  in `jsIdent` and the per-target reserved-word special-casing. Wide
  surface across all three codegens (every local identifier emission).
- **Closure capture / lambda param rewriting** to match.
- **Synthesized handler-helper names** that overlap with locals (e.g.
  `_v` setter param, `_op`, `_msg`) — fold into the `__` rename pass
  if they aren't covered above.
- **Subclass visibility enforcement** — Pass 1 establishes the
  namespacing; the validator's subclass-visibility check (bare and `@`
  inherited, `#` not) is a separate piece of work that can ride along
  or come later.

---

## Suggested order of patches

1. Parser: preserve `@` in `RefDecl`; update synthesized getter/setter
   bodies to read sigiled name. Snapshot/round-trip tests.
2. Per-target codegen: introduce `stateKey` lowering, route all sites
   through it, drop `@`-stripping. One target at a time.
3. Parser: open up `#`-property forms at constructor scope. New tests.
4. Validator: explicit reject for `#`-decls outside constructor scope.
5. Codegen: synthesized-helper `__` rename pass.

Each patch is independently testable; (1) alone fixes the immediate
ref-cell collision.
