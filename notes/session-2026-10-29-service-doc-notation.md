# Service-document notation: no entry colon, no `=` on types — 2026-10-29

IMPLEMENTED, green: js on the 89 test files that touch interfaces / remotes /
types (1900 passed), browser on the 15 suites that load the DOM / document
manifests (665 passed), rust on the two subscribe suites that exercise the
remote-field lookup (29 passed). Erlang not run (no erlang-specific code
touched). Follows `session-2026-10-28-delimited-class-star-body.md`, which
moved the constructor `*` onto the body in source; this pass does the same for
service documents.

## Grammar

Every entry is a name, a space, and a definition. One entry per line, or
comma-separated.

```
{
  ::Point (x Integer, y Integer)          type declaration (no `=`)
  add (a: Integer, b: Integer) -> (sum: Integer)
  clone () -> (Node)                      overloads: one line each, name repeated
  clone (deep: Boolean) -> (Node)
  log! (Text) => .                        silent
  empty? () -> (Boolean)                  names may end in `?` / `!`
  Counter (start: Integer) -> *{          constructor; body always written
    get () -> (value: Integer)
  }
  Text (Node |) -> *{}                    supertype, no members of its own
  set label (Text)                        settable field
  count *Integer                          ref cell — readable and settable
  total Integer                           read-only field
}
```

- Only the entry colon is gone. Inside parens, `name: Type` (named) vs `Type`
  (positional) is unchanged, in params, returns and type fields.
- The space after the name is any run of whitespace, including none; the
  emitter always writes one.
- The `->` before a return or `*{` is optional on input, always emitted.
- Returns are always parenthesized, or `.`. `-> Integer` is an error.
- A constructor always writes a body; `Text (Node |)` is an error ("missing
  return … `-> *{}`").
- `...Parent` spread lines (emitted for subclasses) are still ignored on input.

### Read-only fields

`name Type` (bare, no `*`) is a read-only field: a zero-arg getter that cannot
be set.

- Top-level: `Remote.count <- 5` → `'Remote.count' is a read-only property`.
  Read / call / `.subscribe` work.
- Inside a constructor body: it is a getter with no setter, so the existing
  manifest field-set discipline rejects it (`'Box' has no settable field
  'total' (available: …)`). `name *Type` adds both getter and setter.

Parsed shape (`parseInterface`): a field adds a getter overload under
`result[name]` plus `result.__fields[name] = { type, readOnly }`; top-level
`set name (Type)` goes to `result.__setters` (previously it overwrote the
getter under `result[name]`).

## Constructor profile in source (mechanical)

```brevity
*
  "thing.bv": (Thing) (a: Integer) -> *{ get () -> (value: Integer) }
*
Coerced = Other as (a: Integer) -> *{ get () -> (value: Integer) }
```

- `(Alias) *( … ) -> { … }` and `as *( … ) -> { … }` are retired with
  messages naming the new form.
- A remote service string that is itself a constructor profile is
  `( … ) -> *{ … }` (was `*( … ) -> { … }`).
- Service constraints (`x as { … }`, `(inner { … })` params) drop the entry
  colon: `{ @get (key: Text) -> (value: Text) }`.
- Source type declarations: `::Point (x Integer, y Integer)`; lineal
  `::Point` + indented fields. `::Point = …` is an error.

### Deferred: the header colon

> **Resolved (same day):** the colon stays. It is the key/value colon
> (`:HTML` = `HTML: HTML`), so there is nothing to drop; option (a) was
> wrong. Single-name parens are dropped instead (`"thing.bv": Thing #`). See
> `session-2026-10-29-params-document-header-notation.md`.

`"thing.bv": (Thing) …` and `HTML: (:div)` keep their colon. Dropping it is
safe for quoted paths, but for bare-identifier paths `HTML (:div)` would
collide with a positional file param that has a paren type (`pt (x Integer)`,
`cb (s: Integer) -> .` both parse today). Options discussed: (a) sigil
shorthand `:HTML (:div)` — matches the params-doc emitter's `:path (members)`,
needs the prefix-colon file param `:url Text` retired for good; (b) quote it,
`"HTML" (:div)`; (c) keep the colon only for bare paths. Leaning (a). About
212 bare-identifier sites.

## Code

- `src/codegen/javascript/types.js` — new service-document parser
  (`parseEntries` / `parseEntry` / `parseSignature` / `parseConstructor`)
  replaces the old char tokenizer, which silently skipped anything it didn't
  recognise. Retired forms now throw. `parseFieldList` splits on top-level
  commas only, rejects prefix-colon fields, and no longer reads `Geom::Point`
  as a label.
- `index.js` — emitter: no entry colon, `::Name (…)`, `-> *{…}` / `-> *{}`,
  one line per overload, `set name (Type)` for setters.
- `src/parser.js` — `parseTypeDecl` (no `=`), `ctorProfileAhead` /
  `parseCtorProfileParams` shared by header deps and coercions,
  `parseServiceConstraint` (no colon, optional arrow, `.`), `parseInlineIface`
  re-renders depth-aware so nested `*{ … }` bodies and multi-line entries
  survive.
- `src/validate.js` — `parseConstructorManifest` for `( … ) -> *{ … }`;
  read-only check in `checkFieldSet`.
- `src/codegen/rust/statements.js` — `findRemoteFieldType` uses
  `parseInterface` instead of two colon-keyed regexes.
- `src/codegen/javascript/classes.js` — `stripAsTypeSuffix` returns just the
  `{ members }` (also drops a constructor profile).
- `src/codegen/browser/runtime.js` — DOM and document manifests migrated;
  `|` overloads split onto lines; prefix-colon params → `name: Type`.

## Bugs found and fixed along the way

- **Named function-typed file param** `cb: (s: Integer) -> .` failed to parse:
  the header took `cb: (` for a bare-identifier dependency (`HTML: (`), and
  `parseOneParam` took `name: (` for the rename-alias form `name: (alias)
  Type`. Both now look past the paren group for `->`.
- **Manifest positional returns read as named.** Synthesised manifest-class
  methods gave positional return fields `key: null`; the return-shape check
  (c6fe13e) treats any defined `key` as named, so binding a positional result
  of a method the class declares itself failed — e.g. `n Text = l.href()` on
  an `a` from the DOM manifest ("returns only named fields ()"). Inherited
  methods (`div().id()`) escaped: the shape check doesn't see them. Positional
  fields now carry no `key`.
- **Lineal header swallowed all errors** in its entry run (falls back to the
  no-params form). Retired-form errors are marked `fatal` and re-thrown.
- **Constructor-body overloads** with `|` were mis-parsed by the old tokenizer
  (only the first arrow was found); one-line-per-overload fixes it by
  construction.

## Tests

- New: `__tests__/services/interface_notation.test.js` — every entry form,
  retired forms, emitted form + round trip, read-only validation (service and
  class level), constructor profiles in header / delimited header / coercion,
  service constraints, source type decls, function-typed file params.
- Migrated: ~50 test files, `__tests__/**/*.md`, `docs/`, root `*.md`,
  `agent-resources/brevity-writing/references/`.

## Open

- Header colon (above).
- `__tests__/README.md` still advertises `*( ... ) =` dependency headers
  (stale since the lineal / delimited header change, not this one).
- The params document (`interface.params`) is still emitted as
  `*( entries )`, the retired header shape. Belongs with the header-colon
  decision.

## Follow-up: return-shape check on inherited methods

The call-result shape check (c6fe13e) only looked at methods the receiver's
class declares itself, so `n Integer = b.get()` / `:x = b.get()` against an
inherited method were never checked — local subclasses and manifest classes
alike. It now resolves the declaring class (the receiver's, else the nearest
ancestor; later supertypes win, matching `resolveSuperclassChain`) and uses
that class's own state/param types. Tests in
`__tests__/destructure/named_returns.test.js` (js / erlang / rust green).

Found while writing the runtime test: **js dropped an empty-bodied subclass**
(`Box = (Base |) *{}`) — the active-actor filter in `classes.js` required own
functions/state/params, so `Box()` failed at runtime. Erlang and rust were
fine. Subclasses are now always emitted.
