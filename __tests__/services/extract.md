# `extract()`

LLM orientation: `extract()` is the parse/interface-discovery phase. It is
allowed to succeed before all remote interfaces are known.

## API Shape

```js
const { ast, interface: iface } = extract(source)
```

Returned fields used by tests:

- `ast`: parsed program.
- `interface.params`: compact file-level class/dependency summary.
- `interface.service`: public service document for handlers and public
  classes.

## `interface.params` Rendering

The file actor's construction-time inputs render in declaration order, inside
`( … )` (`()` when empty): the caller-facing side of the header, keys and
types only.

- `"/db": { … }`: service dependency with an inline interface.
- `"thing.bv": ( … ) -> *{ … }`: class dependency with an inline profile.
- `"thing.bv": #`: class dependency; the profile comes from the remote.
- `"/db":`: dependency; its type comes from the remote.
- `"name": Type`: named scalar param (a renamed param shows its key).
- `Type`: positional scalar param.

Every named key is quoted (keys are paths); a positional entry is only its
type. Bindings are private and not surfaced — a dependency's local name or
destructure, a positional param's name, a renamed param's local:

```brevity
*
  "/db": DB
  HTML: (:div, :span)
  limit: n Integer
*
```

renders params as:

```text
(
  "/db":
  "HTML":
  "limit": Integer
)
```

Read back (a remote's `params` in `compile` options), the scalar entries give
the constructor signature that calls to the dependency are checked against.
Dependency entries are skipped for now. The retired `*( … )` shape is rejected.

## `interface.service` Rendering

Public `@` handlers appear in the service document. Private and bare helper
functions do not.

Examples:

```brevity
@greet = (name: Text) -> greeting: "hi"
```

renders:

```text
{
  greet (name: Text) -> (greeting: Text)
}
```

Optional args render with `?`:

```text
greet (name: Text, ? greeting: Text) -> (result: Text)
```

## Extract vs Compile

`extract()` can parse a file with unresolved remote dependencies. `compile()`
performs validation and needs either inline constraints or `options.remotes`.

Round-trip pattern:

```js
const { interface: remoteIface } = extract(remoteSource)
const { ast } = extract(consumerSource)
compile(ast, { remotes: [{ path: 'Remote', service: remoteIface.service }] })
```

## LLM Rules

- Use `extract()` when the task is interface discovery.
- Use `compile()` when the task is validation or target output.
- Do not expect aliases like `DB` to appear in `interface.params`.
- Mention that `extract()` is intentionally lighter than full validation.
