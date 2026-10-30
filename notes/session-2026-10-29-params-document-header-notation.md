# Header bindings, lone names, params document, inline wins — 2026-10-29

IMPLEMENTED, uncommitted for review. Resolves "Deferred: the header colon" and
the params-document item in `session-2026-10-29-service-doc-notation.md`.

Replaces a first attempt (reverted) that added a `:path (Alias)` header form.
That was wrong: the header colon is the key/value colon (`:HTML` is shorthand
for `HTML: HTML`, as `:div` is for `div: div`), so `:HTML (:div)` means
`HTML: HTML (:div)`. The colon form stays.

## Decisions

1. **A header entry is `key: binding [type]`.** The key is a path. The
   binding is a local name, one member, or a destructure group. A
   dependency is a named param whose key is a path and whose type is an
   interface, a constructor profile, or `#`.

   ```
   *
     "thing.bv": Thing #
     "/db": DB { get (key: Text) -> (value: Text) }
     "lib.bv": Lib (a: Integer) -> *{ ping () -> . }
     HTML: :div                  one member, no parens
     HTML: (:div, :span)         parens only to group several
     :HTML                       HTML: HTML
     limit: Integer
     limit: n Integer            renamed: callers pass `limit`, the file sees `n`
   *
   ```

2. **No parens around a single name** — anywhere. `"thing.bv": (Thing) #`,
   `key: (k) Type`, `key: (k)`, `key: (k) *` are retired with a message
   naming the new form. A function type keeps its parens
   (`cb: (Integer) -> (Integer)`). The accessor-remap form
   `key: (l) :b` keeps its own retired message.

3. **Lone names resolve by scope.** A type name in scope is reserved: no param
   may share it. So after a named param's colon, `key: X` is the type X when
   one is in scope, otherwise the param's local (untyped). In scope:
   built-ins, the file's `::` types and classes, every name the header binds.
   Two names are always local + type: `key: k Integer`.
   - Resolved after parsing (`resolveLoneNames` at the end of `parse()`):
     types may be declared after their use.
   - Bodiless signatures (a dependency's constructor profile, `emit`
     declarations) have no locals; a lone name there is the type.
   - A misspelt type reads as a rename. When the body then uses the key and
     never the local: "'Intger' is not declared or imported, so 'limit:
     Intger' names the param's local 'Intger' and leaves 'limit' unbound".
   - A public handler's renamed param still needs a type.
   - Header: every key is a path. A keyed entry with no type is a
     dependency resolved by its key — `HTML: Html`, `"svc.bv": Svc`,
     `limit: n`, `limit:` — and needs an inline type or the remote's
     document (compile error otherwise: "'HTML' (bound as 'Html') has no
     type"). A typed entry (`limit: Integer`, `limit: n Integer`) is a value
     supplied at construction. Positional entries have no key and stay values.

4. **Params document = the caller-facing side of the header**, `( … )`:

   ```
   (
     Text
     "/db": {
       get (key: Text) -> (value: Text)
     }
     "lib.bv": (a: Integer) -> *{
       ping () -> .
     }
     "thing.bv": #
     "svc.bv":
     "limit": Integer
   )
   ```

   A positional entry is only its type (never a name). A named entry is
   `"key": Type`; every named key is quoted (keys are paths). A dependency
   with no declared type is `"key":` — the colon, not the quotes, marks a key.
   Bindings dropped (aliases, destructures, positional names, rename locals);
   `"geometry.bv": (:Point)` renders as `"geometry.bv":` — the compiler only
   needs the key to resolve. `*( … )` is retired (error). The reader splits
   entries by bracket depth and skips dependency entries (type absent, `#`,
   `{ … }`, or a profile) for now.

5. **An inline definition wins over the remote document.** `"/db": DB { … }`
   or `Lib ( … ) -> *{ … }` is the file's statement of what it needs: calls
   are checked against it and `options.remotes` is not consulted for that
   dependency (validate and js codegen). A mismatch with the real service is a
   runtime failure. Before, the remote document silently replaced the inline
   one.

## Code

- `src/parser.js` — `isRetiredParenAlias` / `startsRenamedParam` /
  `parseRenamedParam` / `isLoneNameAfterColon`, used by both param parsers;
  untyped keyed header entries become dependencies in `resolveLoneNames`;
  the old `key: (alias) *` keyed-ref branch removed (now `key: alias *`).
  Header: `isBareKeyDependency`, binding parse (name / `:member` / group),
  `fileParamFrom` (carries `key`). `resolveLoneNames` at the end of `parse()`.
- `src/ast.js` — `BUILTIN_TYPE_NAMES` (moved from validate); `fileParam`
  takes `key`.
- `index.js` / `src/codegen/browser/brevity.js` — file params carry `key` into
  the file actor; `renderParamsEntry` / `dependencyTypeText` /
  `buildParamsDocument`.
- `src/validate.js` — `parseParamsDocument` + `splitParamsEntries`; inline
  definitions skip `ingestRemote`; "has no type" message (was "requires an
  interface").
- `src/codegen/javascript/classes.js` — inline remotes override resolved ones.
- Test runners (`src/codegen/{javascript,rust,erlang,browser}/index.js`) —
  named `constructorArgs` map by key, so a renamed file param receives its
  arg.

## Tests

- New: `functions/param_rename.test.js` (rename runs on every target, lone
  name → type / local, defaults, public handlers, published and file params,
  keyed ref, misspelt-type hint, reserved names, retired parens),
  `services/header_bindings.test.js` (header forms, retired parens, inline
  wins over the remote, remote used when no inline definition).
- `services/extract.test.js` — new params-document shape; renamed key;
  bare-key quoting; multi-line dependency entries read back.
- Migrated: ~280 single-name paren sites in `__tests__`, `docs/`,
  `agent-resources/`, root `*.md`, `src/` comments and the browser
  `document` DI string. Lambdas (`onpress: (s) { … }`) untouched.

## Open

- **Capitalization in the parser** — ~25 sites still decide type vs. name by
  case (destructure statements, `peekIsType`, …). Ticket filed by the user;
  the same scope rule should replace them.
- **Caller-supplied dependencies** (`Svc("a", "/db": myDb)`): checking them
  against the params document's dependency entries. Next.
- A header spread (`HTML: (...)`) brings in names the parser can't see, so
  they aren't reserved.
- The params document drops defaults/optionality (pre-existing).
