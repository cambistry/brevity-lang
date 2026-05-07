# Usage

## Compiling

The host API is two-phase:

```javascript
import { extract, compile } from 'brevity-lang';

const source = `
  @ping = -> value: 1 as Integer
`;

const { ast, interface: iface } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract()` returns:

- `ast`: parsed Brevity AST
- `interface.params`: the file-constructor manifest
- `interface.service`: service document for the public surface

`compile()` takes that AST and emits source for `js`, `rust`, or `erlang`.

## File-level constructor params

A file can declare its construction-time inputs in a top-level `*( ... )` header:

```
*(
  "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
  "/services/cache": (Cache) { get: (:key Text) -> (:value Text) }
)
=

@fetch = (:key Text) {
  :value Text = DB.lookup(:key)
  -> :value
}
```

That header can mix service injections and ordinary scalar params. Service
entries map a path to a local alias, and the alias is what you use in code
(`DB.lookup(...)`). Two service forms are supported:

- **Inline constraint**: `"/path": (Alias) { method: sig, ... }` — the service
  interface is declared inline. No external resolution needed.
- **Bare dependency**: `"/path": (Alias)` — this parses, but the interface must
  be supplied externally at compile time via `options.remotes`.

Scalar params live in the same header:

- Named scalar: `:port Integer`
- Positional scalar: `root Text`

Inside the file, all of these entries behave like constructor inputs to the
anonymous file actor. From the host side, the header is surfaced as a compact
manifest string in `interface.params`.

### Build system integration

`extract()` surfaces the whole file-constructor shape in `interface.params`:

```javascript
const { interface: iface } = extract(source);
// iface.params:
//   <
//     :"/services/db"
//     :"/services/cache"
//   >
```

For service injections, `interface.params` preserves the path entry itself.
Whether the service was declared inline or needs to be resolved through
`options.remotes` remains a host concern.

For example, a mixed header might come back as:

```javascript
const { interface: iface } = extract(`
  *(
    root Text
    "/services/db": (DB)
    :cache_size Integer
  )
  =
  @noop = .
`);

// iface.params:
//   <
//     Text
//     :"/services/db"
//     :cache_size Integer
//   >
```

For compilation purposes, the important case today is service resolution. A
compilation environment can inspect `iface.params`, resolve the required service
interfaces, and pass them back to `compile()`.

The test-backed form is an array of remote service documents keyed by path:

```javascript
compile(ast, {
  remotes: [
    { path: 'DB', service: dbManifest },
    { path: 'Cache', service: cacheManifest },
  ],
});
```

`interface.params` is intentionally host-facing. It is the summary a build
system needs in order to:

- discover required remote services
- distinguish service inputs from scalar constructor inputs
- render or cache a stable file-level manifest

Once the host has resolved the service side, `compile()` can perform full type
checking across file boundaries — undefined methods, wrong argument types, and
silent-return violations are all caught at compile time.

Bare dependencies that are not resolved via `options.remotes` will fail
compilation.

## JavaScript target

The JS target emits an ES module with a default export.

```javascript
const { ast } = extract(source);
const output = compile(ast, { target: 'js' });

const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
const { default: Actor } = await import(dataUrl);

const binding = {
  post(message) {
    console.log(message);
  }
};

const actor = await Actor.create(binding);
actor.receive({ id: '1', op: '@ping', from: 'caller' });
```

## Erlang target

The Erlang target emits a `brevity_actor.erl` module that reads newline-delimited
JSON from stdin and writes newline-delimited JSON to stdout.

```bash
erlc brevity_actor.erl
echo '{"id":"1","op":"@ping","from":"caller"}' | erl -noshell -pa . -eval 'brevity_actor:main()' -s init stop
```

## Rust target

The Rust target emits a `main.rs` for a small Cargo binary that reads stdin and
writes stdout in the same wire format as Erlang.

```bash
cargo build
echo '{"id":"1","op":"@ping","from":"caller"}' | ./target/debug/brevity-actor
```

## Wire format

Actors communicate with JSON messages.

Simple op:

```json
{ "id": "1", "op": "@ping", "from": "caller" }
```

Op with payload:

```json
{ "id": "2", "op": [{ "n": 5 }, "@double"], "bv-a": [{ "n": "Integer" }], "from": "caller" }
```

Reply:

```json
{ "id": "2", "re": { "result": 10 }, "bv-a": { "result": "Integer" }, "to": "caller" }
```

Unhandled message:

```json
{ "id": "3", "ex": { "@missing": "unhandled" }, "to": "caller" }
```

`bv-a` is the type attestation attached to payloads and replies.

## Special senders

Some internal senders bypass normal external validation rules:

| `from` | Meaning |
|---|---|
| `__parent` | Message from parent actor |
| `__self` | Internal self-send |
| `__test` | Test harness |

## Capture and hydrate

Actors support state capture and restore through CAM messages.

Capture:

```json
{ "id": "1", "cam": "capture", "from": "parent" }
```

Hydrate:

```json
{ "id": "2", "cam": [{ "count": 5 }, "hydrate"], "from": "parent" }
```
