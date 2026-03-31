# Usage

## Compiling

The host API is two-phase:

```javascript
import { extract, compile } from 'brevity-lang';

const source = `
  count *Integer = 0

  @inc = {
    count <- count + 1
    -> value: count as Integer
  }
`;

const { ast, manifest } = extract(source);
const output = compile(ast, { target: 'js' });
```

`extract()` returns:

- `ast`: parsed Brevity AST
- `manifest.service`: service document for the public surface

`compile()` takes that AST and emits source for `js`, `rust`, or `erlang`.

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
actor.receive({ id: '1', op: '@inc', from: 'caller' });
```

## Erlang target

The Erlang target emits a `brevity_actor.erl` module that reads newline-delimited
JSON from stdin and writes newline-delimited JSON to stdout.

```bash
erlc brevity_actor.erl
echo '{"id":"1","op":"@inc","from":"caller"}' | erl -noshell -pa . -eval 'brevity_actor:main()' -s init stop
```

## Rust target

The Rust target emits a `main.rs` for a small Cargo binary that reads stdin and
writes stdout in the same wire format as Erlang.

```bash
cargo build
echo '{"id":"1","op":"@inc","from":"caller"}' | ./target/debug/brevity-actor
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
