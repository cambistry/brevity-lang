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

The file actor's construction-time inputs render in declaration order:

- `:"/db"`: service dependency path.
- `:"thing.bv" #`: class dependency path.
- `:name Type`: named scalar param.
- `Type`: positional scalar param; binding name is dropped.

The local alias is intentionally not surfaced:

```brevity
*( "/db": (DB) )
=
```

renders params as:

```text
*(
  :"/db"
)
```

## `interface.service` Rendering

Public `@` handlers appear in the service document. Private and bare helper
functions do not.

Examples:

```brevity
@greet = (:name Text) -> greeting: "hi"
```

renders:

```text
{
  greet: (name: Text) -> (greeting: Text)
}
```

Optional args render with `?`:

```text
greet: (name: Text, ? greeting: Text) -> (result: Text)
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
- Do not expect aliases like `(DB)` to appear in `interface.params`.
- Mention that `extract()` is intentionally lighter than full validation.
