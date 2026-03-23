# Usage

## Compiling

```javascript
import compile from 'brevity-lang';

const source = `
  ref count : Integer = 0

  @inc = {
    count <- count + 1
    -> :count
  }

  @get = -> :count
`;

// Target: 'js' (default), 'erlang', or 'rust'
const { output } = compile(source, { target: 'js' });
```

`compile()` returns `{ output, manifest, sourcemap, errors }`. `output` is the generated source code as a string.

## JS actors

The JS target emits an ES module with a default-exported class.

```javascript
const { output } = compile(source, { target: 'js' });

// Load the class (e.g. via dynamic import or data URL)
const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
const { default: Actor } = await import(dataUrl);

// Instantiate with a binding — the actor posts all outbound messages here
const binding = {
  post(message) {
    console.log('actor says:', message);
  }
};
const actor = new Actor(binding);

// Send a message
actor.receive({ id: '1', op: '@inc', from: 'caller' });
// binding.post will be called with: { id: '1', re: { count: 1 }, to: 'caller', 'bv-a': ... }
```

Constructor params for child actor types are passed after the binding:

```javascript
const box = new Box(binding, 42); // Box(seed : Integer)
```

## Erlang actors

The Erlang target emits a single-file module (`brevity_actor.erl`) that reads JSON messages from stdin and writes JSON responses to stdout.

```bash
# Compile
erlc brevity_actor.erl

# Run — messages are newline-delimited JSON on stdin
echo '{"id":"1","op":"@inc","from":"c"}' | erl -noshell -pa . -eval 'brevity_actor:main()' -s init stop
```

## Rust actors

The Rust target emits a `main.rs` that reads JSON from stdin and writes JSON to stdout, same as Erlang.

```bash
# Write output to src/main.rs in a Cargo project, then:
cargo build
echo '{"id":"1","op":"@inc","from":"c"}' | ./target/debug/brevity-actor
```

## CAM messaging

Actors communicate through plain JSON messages. Every message has an `id` for correlation and a `from` field identifying the sender.

### Sending an operation

```json
{ "id": "1", "op": "@inc", "from": "caller" }
```

Operations with arguments use an array where the last element is the op name:

```json
{ "id": "2", "op": [{ "n": 5 }, "@add"], "bv-a": [{ "n": "Integer" }], "from": "caller" }
```

`bv-a` (Brevity type attestation) carries the type schema for the payload. It is required when sending arguments from external callers. Internal senders (`__parent`, `__self`) are exempt.

### Replies

```json
{ "id": "2", "re": { "sum": 15 }, "bv-a": { "sum": "Integer" }, "to": "caller" }
```

`re` is the return value. `bv-a` on the reply carries the return types. `to` echoes back the original `from`.

### Errors

```json
{ "id": "3", "ex": { "@unknown": "unhandled" }, "to": "caller" }
```

### Set and update (fire-and-forget)

Actors can declare `set` and `update` handlers. These are dispatched via `::set` and `::update` ops and produce no reply.

```json
{ "op": [[42], "::set"], "from": "__parent" }
```

### Capture and hydrate

Serialize actor state:

```json
{ "id": "1", "cam": "capture", "from": "parent" }
→ { "id": "1", "re": { "count": 5 }, "to": "parent" }
```

Restore into a fresh instance:

```json
{ "id": "2", "cam": [{ "count": 5 }, "hydrate"], "from": "parent" }
→ { "id": "2", "re": "hydrate", "to": "parent" }
```

### Special `from` values

| `from` | Meaning |
|---|---|
| `__parent` | Message from parent actor — bypasses schema validation |
| `__self` | Internal self-send — bypasses schema validation, reply routes back to self |
| `__test` | Test harness — bypasses schema validation |

### Test messages

The `test` namespace provides privileged access to actor internals for testing:

```json
{ "id": "1", "test": { "get": "count" }, "from": "t" }
{ "test": { "set": 42 }, "from": "t" }
{ "test": { "update": { "name": "Alice" } }, "from": "t" }
{ "id": "2", "test": { "op": "@inc" }, "from": "t" }
{ "id": "3", "test": { "get": "val", "target": "child.inner" }, "from": "t" }
```

`get` reads state directly (returns a reply). `set` and `update` dispatch silently (no reply). `op` dispatches any operation. `target` routes to a child actor by dotted path.
