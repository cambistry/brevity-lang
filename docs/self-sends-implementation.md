# Self-Sends: Implementation Notes

## Overview

Private function calls in Brevity are now **self-sends** — they route through the actor's message dispatch rather than being direct method calls. This means every function defined in an actor body is a handler on `self`, addressable by name through the same dispatch path as public `@` functions.

A call like `double(5)` inside a handler body compiles to a message `{op: [[5], "double"]}` sent to `self`. The dispatch finds the `"double"` handler, executes it, and returns the result to the caller.

## Motivation

1. **Forward references**: Functions defined later in the actor body can be referenced by functions defined earlier, because the reference is a name (message target), not a captured value.

2. **Uniform dispatch**: Public and private functions use the same dispatch path. No semantic difference — only visibility (`@` marks the public API).

3. **Testability**: Internal functions can be exercised by sending messages directly, without needing public wrapper functions.

4. **Future: actors all the way down**: Sub-processes hosted by an actor are messageable through the parent with the same affordances. Self-sends are the first step.

## Wire Format

Self-sends use the same op format as external messages:

```
// No args
{ id, op: "functionName", from: "__self" }

// Positional args
{ id, op: [[arg1, arg2], "functionName"], from: "__self" }

// Named-only args
{ id, op: [{ key: value }, "functionName"], from: "__self" }

// Mixed positional + named
{ id, op: [[pos1, pos2, { key: value }], "functionName"], from: "__self" }
```

The `from: "__self"` marker tells dispatch to:
- Skip schema/bv-a validation (self knows its own types)
- Skip type matching guards (the caller already resolved the right handler)
- Route the reply back internally rather than to the external binding

## JavaScript Implementation

### Architecture

JS actors are classes with `#dispatch(message)` as the central routing method. Self-sends add a `#selfSend(op)` method that:

1. Creates a pending promise keyed by a unique ID
2. Calls `#dispatch` directly (awaited) with `from: "__self"`
3. Dispatch executes the handler, builds the reply, and routes it back through `receive()`
4. `receive()` resolves the pending promise with the `re` value
5. The caller wraps the result in `Structure.pack()` to get a Structure object

```javascript
async #selfSend(op) {
    const id = String(++this.#nextId);
    const p = new Promise(resolve => this.#pending.set(id, resolve));
    await this.#dispatch({ id, op, from: '__self' });
    return p;
}
```

### Dispatch Routing

The reply routing in `#dispatch` checks `from`:

```javascript
const _route = from === '__self'
    ? (msg) => this.receive(msg)    // back to self — resolves pending promise
    : (msg) => this.#binding.post(msg);  // external — goes to stdout/parent
```

This applies to success replies, error replies, and unhandled replies.

### Call Site Generation

A private function call `double(5)` generates:

```javascript
// Old (direct call):
await this.#doubleFn(Structure.pack([5]))

// New (self-send):
Structure.pack(await this.#selfSend([[5], "double"]))
```

The `Structure.pack()` wrapper converts the wire-format `re` value back into a Structure for the caller to destructure.

### FnRef (`&name`)

Function references to actor functions generate a closure that self-sends:

```javascript
// &double becomes:
(async (_s) => Structure.pack(
    await this.#selfSend([Structure.splat(_s), "double"])
))
```

This wraps the Structure's positional/named values back into wire format for the self-send.

### Private Functions in Dispatch

Private functions are added to the same `if/else if` dispatch chain as public functions:

```javascript
if (opName === "test") { ... }
else if (opName === "double" && (from === '__parent' || from === '__self' || _matchTypes(...))) { ... }
```

The `from === '__self'` check bypasses type matching — the caller already knows the types.

### Key Challenge: Async Timing

The initial implementation used `this.receive({ id, op, from: '__self' })` inside the promise constructor. But `receive()` calls `#dispatch()` without `await`, so dispatch hadn't completed when the promise caller continued. The fix: call `#dispatch` directly with `await`:

```javascript
const p = new Promise(resolve => this.#pending.set(id, resolve));
await this.#dispatch({ id, op, from: '__self' });  // must await
return p;
```

### Key Challenge: Closure Capture

The JS codegen wraps lambdas in IIFEs to capture free variables. State variables (`_stateVarNames`) must be excluded from capture — they're accessed via `this.#name`, not as closures. Similarly, actor function names (`_actorFnNames`) are excluded since they're now self-sends, not local variables.

---

## Erlang Implementation

### Architecture

Erlang actors are single-process modules where `handle_op/5` is the dispatch function. Self-sends add a `self_send/2` helper that calls `handle_op` directly and wraps the result:

```erlang
self_send(OpName, Payload) ->
    {ok, Re, _Bva} = handle_op(OpName, #{}, Payload, <<"0">>, <<"__self">>),
    structure_pack(Re).
```

This is simpler than JS because Erlang is synchronous within a process — no promises needed.

### Call Site Generation

A private function call `double(5)` generates:

```erlang
%% Old (direct call):
double_fn({[5], #{}})

%% New (self-send):
self_send(<<"double">>, [5])
```

The result is already a Structure tuple `{Positional, Named}` because `self_send` calls `structure_pack(Re)` on the wire-format reply.

### FnRef (`&name`)

Function references generate lambdas that self-send:

```erlang
%% &double for over/reduce:
fun(Item_) -> structure_one(self_send(<<"double">>, [Item_])) end
```

### Private Functions in Dispatch

Private functions are added to `genDispatch` alongside public functions. The same `handle_op` clause chain handles both:

```erlang
handle_op(<<"test">>, Message, Payload, _Id, _From) -> ...;
handle_op(<<"double">>, Message, Payload, _Id, _From) -> ...;
handle_op(Op, _Message, _Payload, _Id, _From) -> {error, Op}.
```

### Type Matching Bypass

Erlang type matching uses `try_op_N` helper functions that check `bv-a`. For self-sends, `From` is passed through to the try functions:

```erlang
try_double_0(Message, Payload, From) ->
    case (From =:= <<"__self">> orelse match_types_positional(Message, ...)) of
        true -> ...;
        false -> nomatch
    end.
```

The `From =:= <<"__self">>` short-circuits the type check.

### Key Challenge: Function Definition Order

Erlang requires functions to be defined before they're referenced (or forward-declared). The `self_send` helper calls `handle_op`, so it must be emitted AFTER `handle_op` in the generated module. The codegen places `self_send` after the `handle_op` clauses.

### Key Challenge: Named-Only Payloads

`greet(name: "world")` has no positional args, only a named arg. The payload must be `#{<<"name">> => <<"world">>}` (a map), not `[#{...}]` (a list containing a map). The codegen detects this case:

```javascript
if (posArgs.length > 0) {
    return `self_send(..., [${posArgs}, #{...}])`;  // mixed
}
return `self_send(..., #{...})`;  // named-only — map, not list
```

### Key Challenge: SSA and Reply Fields

Erlang variables are single-assignment (SSA). When a variable is rebound (`x = 1; x = 2; x = 3`), the codegen generates `X`, `X__1`, `X__2`. Reply fields like `-> :x` must resolve to the latest SSA binding. The `resolveSSAName` function handles this, with `stmtIdx` set to `body.length` for the reply statement to ensure it sees all bindings.

---

## Rust Implementation

### Architecture

Rust actors are structs with a `dispatch` method. Self-sends extract the match logic into a `handle_op` method that returns the result directly:

```rust
fn handle_op(&mut self, op_name: &str, message: &Value, payload: &Value, from: &str)
    -> (Option<Value>, Option<Value>, bool)
{
    let _s = Structure::pack(payload);
    let mut re: Option<Value> = None;
    let mut bva_re: Option<Value> = None;
    let mut handled = false;
    match op_name {
        "test" => { ... }
        "double" if from == "__self" || match_types_positional(...) => { ... }
        _ => {}
    }
    (re, bva_re, handled)
}

fn self_send(&mut self, op_name: &str, payload: &Value) -> Value {
    let (re, _bva, _handled) = self.handle_op(op_name, &json!({}), payload, "__self");
    re.unwrap_or(Value::Null)
}
```

The `dispatch` method calls `handle_op` and routes the result to the binding. `self_send` calls `handle_op` directly and returns the `re` value.

### Call Site Generation

A private function call `double(5)` generates:

```rust
// Old (direct call):
self.double_fn(&Structure { positional: vec![json!(5)], named: Map::new() })

// New (self-send):
{
    let _payload = json!([5]);
    let _re = self.self_send("double", &_payload);
    Structure::pack(&_re)
}
```

The block expression builds the payload, self-sends, and wraps the result.

### Key Challenge: `json!` Macro Limitations

The `serde_json::json!` macro cannot handle complex Rust expressions inside array literals. Mixed positional+named payloads like `json!([5, { let mut m = Map::new(); ... }])` fail with "unexpected end of macro invocation."

The fix: build the payload using `Vec` and `Value::Array` instead of `json!`:

```rust
{
    let mut _arr: Vec<Value> = vec![json!(10)];
    {
        let mut m = Map::new();
        m.insert("label".to_string(), json!("hi"));
        _arr.push(Value::Object(m));
    }
    let _payload = Value::Array(_arr);
    let _re = self.self_send("mix", &_payload);
    Structure::pack(&_re)
}
```

### Key Challenge: `Structure` Preamble

The `Structure` type was previously only included when the actor needed it (had params or private functions). With `handle_op` always calling `Structure::pack`, the preamble is now unconditionally included.

### Key Challenge: Match Types Functions

The `match_types` and `match_types_positional` functions were only emitted when public functions had typed params. With private functions now in the dispatch chain, these functions must also be emitted when private functions have typed params:

```javascript
const allDispatchFns = [...publicFns, ...privateFns];
const needsMatchTypesPos = allDispatchFns.some(h =>
    h.params.some(p => p.type && !p.rest && p.positional)
);
```

### Lambdas as Dispatch Handlers

When a lambda is passed as an argument to a function with a function-typed parameter (e.g., trailing blocks), the lambda is registered as a temporary dispatch handler with a generated name like `_lambda_0`. The call site passes the handler name as a string in the payload. The receiving function calls `self.call_fn(&f, &payload)` which extracts the handler name and self-sends to it.

```rust
// call_fn: dispatch to a handler name stored in a Value
fn call_fn(&mut self, fn_val: &Value, payload: &Value) -> Value {
    let fn_name = fn_val.as_str().unwrap_or("");
    self.self_send(fn_name, payload)
}
```

At the call site, `double(5) |x| { x * 2 }` generates:

```rust
// The lambda becomes a dispatch handler:
"_lambda_0" => {
    let x: i64 = _s.positional.get(0)...;
    re = Some(json!([json!(x * 2)]));
    handled = true;
}

// The call site passes the handler name as a string:
let _payload = Value::Array(vec![json!(5), Value::String("_lambda_0".to_string())]);
let _re = self.self_send("double", &_payload);
```

`&fnRef` references to actor functions work the same way — `&double` generates `Value::String("double".to_string())` since `double` is already a dispatch handler.

### Key Challenge: Avoiding `json!` Macro

Self-send payloads must be built with native `Value` construction (`Value::Array(vec![...])`, `Value::Object(map)`) rather than the `json!()` macro. The `json!` macro uses pattern matching internally and cannot handle complex Rust expressions like method calls or block expressions inside array literals.

### Key Challenge: Nested `&mut self` Borrows

Nested function-typed param calls like `f(g(1))` require two `self.call_fn` calls. Rust's borrow checker rejects nested `&mut self` borrows in the same expression. The fix: pre-compute inner calls to temporary variables:

```rust
// f(g(1)) generates:
let _fnarg_0 = self.call_fn(&g, &Value::Array(vec![json!(1)]));
self.call_fn(&f, &Value::Array(vec![_fnarg_0]))
```

### Key Challenge: Rust Reserved Keywords

Brevity variable names like `fn` are valid identifiers but are reserved keywords in Rust. All variable declarations and references go through `rustIdent()` which prefixes reserved words with `r#` (e.g., `r#fn`).

### Lambdas as Dispatch Handlers (Returned Functions)

Lambdas that escape their defining scope (returned as values via `->`) are registered as dispatch handlers with state-stored captures. Only escaping lambdas use this path — locally-called lambdas are inlined at call sites by the function pipeline.

```rust
// factory = |n : Integer| { inner = { n } : Integer; inner } : Function
// becomes handler "_lambda_0" with capture of `n` stored in self.state

// At definition site:
self.state.insert("_cap__lambda_0_n".to_string(), json!(n));
let factory = Value::String("_lambda_0".to_string());

// In dispatch:
"_lambda_0" => {
    let n = self.state.get("_cap__lambda_0_n").cloned()...;
    // ... body using captured n
}
```

The `isReturned` guard ensures only escaping lambdas get this treatment:

```javascript
const isReturned = body.some(bs => bs.type === 'Reply' && bs.fields.some(f =>
    (f.name === s.name) || (f.expr?.type === 'Identifier' && f.expr.name === s.name)
));
```

Free variable detection excludes both params and body-local assignments:

```javascript
const localScope = new Set([...paramNames, ...bodyLocals]);
```

### Nested Lambda Inlining

When a lambda body is inlined at a call site, nested function definitions inside that body are tracked and inlined at their own call sites. This handles grandparent-scope capture without real Rust closures:

```
// Source:
x : Integer = 7
outer = |a| {
    inner = { x + a }        // captures x (grandparent) and a (parent)
    result : Integer = inner()
}
result : Integer = outer(3)  // → 10
```

The inlining code tracks `innerFnDefs` within each inlined body. When `outer(3)` is inlined, the body statement `inner = { x + a }` is recognized as a nested function definition and skipped. When `result = inner()` is encountered, `inner` is found in `innerFnDefs` and its body `x + a` is inlined — with both `x` and `a` in scope from the enclosing inlined context.

---

## Cross-Target Consistency

All three targets implement the same semantics:

1. **Private functions are dispatch handlers** — added to the same match/if chain as public functions
2. **Self-sends bypass type matching** — `from === "__self"` / `From =:= <<"__self">>` / `from == "__self"`
3. **Self-sends bypass schema validation** — no `bv-a` required
4. **Reply routing is internal** — self-send replies go back to the caller, not to the external binding
5. **Wire format is identical** — `[payload, "opName"]` regardless of whether the caller is internal or external

The only difference is mechanism:
- **JS**: Promise-based async (dispatch is async, reply resolves pending promise)
- **Erlang**: Synchronous direct call (same process, `handle_op` returns directly)
- **Rust**: Synchronous direct call (`handle_op` returns tuple, `self_send` extracts `re`)
