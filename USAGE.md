# Usage

## Compiling

The host API is two-phase:

```javascript
import { extract, compile } from 'brevity-lang';

const source = `
  @ping = () -> value: 1 as Integer
`;

const { ast, interface: iface } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract()` returns:

- `ast`: parsed Brevity AST
- `interface.params`: the file actor's manifest
- `interface.service`: the Opre service document for the public surface, as JSON
  (`notes/opre-type-encoding-2026-11-21.md`)

`compile()` takes that AST and emits source for `js`, `rust`, or `erlang`.

## File actor params

A file is a singleton: its host builds it once, at load. It declares its DI
with `use` statements, which can appear anywhere in the file, inner scopes
included; the host binds them all at load:

```
use DB = "/services/db" as { lookup (key: Text) -> (value: Text) }
use Cache = "/services/cache" as { get (key: Text) -> (value: Text) }

@fetch = (key: Text) {
  :value Text = DB.lookup(:key)
  return :value
}
```

`use` can mix service injections and ordinary scalar params. Every entry is a
binding, `target = source`, with `use` in front. The source is a name or a
quoted path the host resolves (`HTML`, `"/services/db"`, `HTML::div`); the
target is the local name you use in code (`DB.lookup(...)`), or a destructure.
A lone source binds its last segment: `use HTML` is `use HTML = HTML`, and
`use HTML::div` is `use div = HTML::div`. Two service forms are supported:

- **Inline constraint**: `use Alias = "/path" as { method sig, ... }` — the
  service interface is claimed inline. The compiler checks calls against it and
  never consults `options.remotes` for that path; a mismatch with the real
  service fails at runtime. `as (params) -> *{ … }` claims a constructor
  profile.
- **Bare dependency**: `use Alias = "/path"` — no claim, so it is resolved by
  its source: the interface must be supplied at compile time via
  `options.remotes` (a compile error otherwise). The call says what it does:
  `Alias(…)` constructs and `Alias.f()` messages, each checked against the
  document. (`as #` is retired; the document says what it is.)

A destructure takes members by name, parens optional:
`use :div, :span, p: para = HTML`.

Typed scalar params are bindings with a type, supplied by the host at load:

- Named scalar: `use port Integer = port`
- Named, renamed locally: `use p Integer = port` (callers pass `port`; the file sees `p`)

`use("source")` is the same dependency in value position. It takes one string
literal and is hoisted into the manifest like a statement, with one entry per
source, shared with a `use` statement for the same source. Its binding is the
ordinary `=` it stands in, scoped where that is written, so it works in inner
scopes (functions, constructor blocks, nested actors), where the statement
doesn't:

```
@fetch = (key: Text) {
  db = use("/services/db") as { lookup (key: Text) -> (value: Text) }
  :value Text = db.lookup(:key)
  return :value
}
```

`:div = use("HTML")` in a function binds `div` there only. A body-form
destructure of a statement's dependency (`:div = HTML`) is scoped the same way.
With no `as` and no `options.remotes` document for its source, a `use("…")` is
a compile error.

A `use` in an inner scope (a function body, a branch, a loop, a constructor
block, a nested `actor { }`) is still the file's entry, granted at load whether or not
that code runs. Only its name is scoped: it binds the whole of its scope (above
the line too, as a top-level `use` binds the whole file) and the scopes inside
it, and shadows an outer binding of the name. Elsewhere it is unknown. Binding
or assigning the same name again in that scope is an error. One source used in
several scopes is one entry and one address.

```
@fetch = (key: Text) {
  use DB = "/services/db" as { lookup (key: Text) -> (value: Text) }
  :value Text = DB.lookup(:key)
  return :value
}
```

Inside the file, all of these entries behave like constructor params to the
anonymous file actor. From the host side, its `use` entries are surfaced as the params
document in `interface.params`.

### Build system integration

`extract()` surfaces the caller-facing side of its `use` entries in `interface.params`
— keys and types, without the file's local names. Every named key is quoted;
a positional entry is just its type:

```javascript
const { interface: iface } = extract(source);
// iface.params:
//   (
//     "/services/db": {
//       lookup (key: Text) -> (value: Text)
//     }
//     "/services/cache": {
//       get (key: Text) -> (value: Text)
//     }
//   )
```

A dependency's type is what its entry claims: an interface, a constructor
profile, or nothing, when the type comes from `options.remotes`.

For example, a file's mixed `use` entries might come back as:

```javascript
const { interface: iface } = extract(`
  use root Text = root
  use DB = "/services/db"
  use cache_size Integer = cache_size
  @noop. = {}
`);

// iface.params:
//   (
//     "root": Text
//     "/services/db":
//     "cache_size": Integer
//   )
```

For compilation purposes, the important case today is service resolution. A
compilation environment can inspect `iface.params`, resolve the required service
interfaces, and pass them back to `compile()`.

The test-backed form is an array of remote service documents (each the JSON
`interface.service` of the remote's `extract`) keyed by path:

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
- distinguish service inputs from scalar constructor params
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
actor.receive({ id: '1', op: 'ping', from: 'caller' });
```

## Erlang target

The Erlang target emits a `brevity_actor.erl` module that reads newline-delimited
JSON from stdin and writes newline-delimited JSON to stdout. The module imports the
shared runtime `brevity_rt`, whose source `erlangRuntime()` returns; write it to
`brevity_rt.erl` and compile it beside the actor.

```js
import { erlangRuntime } from 'brevity-lang';
writeFileSync('brevity_rt.erl', erlangRuntime());
```

```bash
erlc brevity_rt.erl brevity_actor.erl
echo '{"id":"1","op":"ping","from":"caller"}' | erl -noshell -pa . -eval 'brevity_actor:main()' -s init stop
```

## Rust target

The Rust target emits a `main.rs` for a small Cargo binary that reads stdin and
writes stdout in the same wire format as Erlang.

```bash
cargo build
echo '{"id":"1","op":"ping","from":"caller"}' | ./target/debug/brevity-actor
```

## Wire format

Actors communicate with JSON messages.

Simple op:

```json
{ "id": "1", "op": "ping", "from": "caller" }
```

Op with payload:

```json
{ "id": "2", "op": [{ "n": 5 }, "double"], "ty": [{ "n": "Integer" }], "from": "caller" }
```

Reply:

```json
{ "id": "2", "re": [{ "result": 10 }], "ty": [{ "result": "Integer" }], "to": "caller" }
```

Unhandled message:

```json
{ "id": "3", "ex": { "missing": "unhandled" }, "to": "caller" }
```

`ty` is the type attestation attached to payloads and replies.

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
