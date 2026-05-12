# Hash tags as exceptions: generalizing `catch`, propagating to CAM

**Date:** 2026-05-11
**Status:** design note. No implementation yet. Captures a working session that started from "can `catch` do error handling?" and ended at a unified hash-tag-as-exception model with trailing `catch` syntax.

## The proposal

Any unhandled hash tag is an exception. Invoking a hash tag is always a throw — it unwinds until something catches it, and if nothing does, it propagates to CAM as an external exception with the tag and its arguments.

```brevity
@div = (a, b) -> if b == 0 #error("division by zero") else (a/b)
```

Uncaught, this leaves the actor with a CAM payload along the lines of:

```
{id: "123", ex: ["division by zero", "#error"], "bv-a": ["Text"]}
```

(RPN-ish ordering for the cause chain — the inner cause first, outer tag last.)

There is no reserved `#error` tag. `#error` is just a convention; the mechanism is identical for `#terminate`, `#timeout`, `#break`, `#continue`, or any user-defined tag:

```brevity
@append = (item Object) {
  if queue.size >= MAX_QUEUE #terminate
}
```

```
{id: "123", ex: "#terminate"}
```

## Why this is the right shape

Three things collapse into one mechanism:

1. **Error handling** — `#error(message)` is the conventional throw for recoverable / reportable errors. No reserved word required.
2. **Loop / structural control flow** — `#break`, `#continue`, `#return` from within nested callbacks (`over`, `reduce`). Previously these needed labeled-break sugar; now they're just thrown sentinels caught at the enclosing scope. This is exactly the codegen path noted in memory (`project_catch_over_reduce`) for the over/reduce label-exit problem — the unified-tag model gives it for free.
3. **Cross-process termination signals** — `#terminate`, `#timeout`, domain-specific failure tags propagate to CAM as data the receiver can act on, with no privileged channel.

One mechanism, three uses. The "exception path" is uniform: a tag, optional structured args, unwinding behavior, optional catch.

## Trailing `catch`

`catch` becomes a trailing modifier, with the lowest precedence — it binds to the entire preceding expression.

```brevity
{
  repeat {
    if cond #break
  }
} catch #break

risky_call() catch #terminate

result = file_call(payload) catch #error (message:) -> message
```

Three forms:

- **Block + catch** — protected scope is the preceding block. Caught path: result is Void (statement-position usage).
- **Expression + catch with no lambda** — swallow the tag; caught-path value is Void/discarded. Legal when the protected expression is Void or its caught-path value is not consumed.
- **Expression + catch with recovery lambda** — recovery lambda must return the same type as the protected expression. This is the *only* place type discipline applies to the exception path.

The lambda destructures tag arguments using the existing keyword-arg binding convention — tag invocations pass a Structure, the catch lambda binds named fields:

```brevity
result = lookup(id) catch #error (message:, code:) -> "fallback for ${code}"
```

Re-throwing from inside the lambda is just invoking another (or the same) hash tag — the propagation mechanism re-enters with no special syntax.

## Type model

The exception path has **no type checking**. Tag invocations carry arbitrary Structures; the throw side is effectively `Any`. The type system only re-engages at the recovery lambda, which acts as the coercion point: its return type must agree with the protected expression's type, joining the two branches.

Bare `catch #tag` (no lambda) is sugar for "handler returns Void" — only legal where the protected expression's caught-path result is itself discarded.

This is the right answer for a young language: it avoids a checked-exceptions surface area, keeps the throw side ergonomic, and still gives callers a single typed coercion point per catch site.

### Why not a sum type?

`Ok(value) | Caught(tag, args)` is more principled but requires structural sums and forces every caller through pattern matching. Pragmatism wins: catch as a join point with a coercion lambda is enough.

## Decided in this session

- **Precedence**: `catch` is lowest. `a + risky() catch #err -> 0` binds to `a + risky()`. (Ruby's `rescue` modifier shape.)
- **Multi-tag**: chaining in v1 — `expr catch #a catch #b -> ...`. Compositional; list syntax (`catch #a, #b`) is a possible later sugar.
- **Tag args**: tag invocations always pass Structures (matches the rest of the language). Catch lambdas destructure with the existing kwarg binding convention.
- **Re-throw**: not special. Invoke another tag inside the lambda and propagation continues.
- **No type-check on the exception path**: only the recovery lambda enforces type agreement.
- **Cross-process identity**: a `catch` clause matches tag invocations from elsewhere by name. `catch #terminate Service.append(item)` catches a `#terminate` thrown anywhere in the call's transitive frame, including across CAM.

## Open: stack traces

The hard part. Traces have to be captured at *throw* time — by the time `catch` runs, the stack is gone. So "request a trace at catch via lambda signature" can't retroactively cause capture. Two viable cost models:

1. **Per-tag policy**: `#error` captures by convention (or registration); cheap control-flow tags (`#break`, `#continue`, `#terminate`) don't. Two-tier, but the tiers correspond to how the tags are actually used.
2. **Build-mode policy**: debug builds capture for every tag, release builds capture for none (or only `#error`). Uniform mechanism, cost determined globally.

The receiving syntax is free either way — the catch lambda's kwarg binding picks up the `trace:` field of the tag payload if present:

```brevity
result = call() catch #error (message:, trace:) -> log(trace, message)
```

If a trace was captured, `trace:` binds; if not, it's Void.

Cross-CAM, traces are diagnostic data — list of `{module, function, line}` records, serializable, but referring to source in the throwing process. Worth deciding now whether trace frames include local values (very useful, expensive, potentially leaks data across the process boundary) or only source positions (cheap, safe, sometimes not enough). Source positions only, in v1, is the conservative pick.

## Open: cleanup on unwind

Currently `catch` is the only construct that unwinds frames. With hash-tag-as-exception, unwinding happens through arbitrary intermediate scopes. If Brevity acquires resources that need release on unwind — open files, network handles, transactions — there is no equivalent of `defer` / `try-finally` / RAII drop today. Not a blocker for the language as it currently stands (cells and closures don't need explicit cleanup), but a question that re-opens as soon as the first such resource lands.

## Open: tag namespacing across CAM

When `#terminate` crosses to CAM and another module catches `#terminate`, are they the same tag? Today the answer is "yes, matched by name string." If modules grow independently, a module-qualified form (`#mymod/terminate`?) may matter. Not urgent — but worth flagging before tag traffic across processes becomes load-bearing.

## Synergy with existing memory notes

- **`project_catch_over_reduce`** — the unification is exactly the thrown-sentinel mechanism the note flags as needed. `over xs { if done #break(value) } catch #break (v:) -> v` works without any special-cased labeled-break support.
- **`self-send-vs-direct-call-2026-05-09`** — direct calls within a runtime preserve normal stack frames, so an unhandled tag unwinds through them naturally. Across runtime boundaries (CAM), the tag becomes a payload on the reply — the queue boundary is already the serialization boundary.

## Suggested ordering (if/when this gets implemented)

1. **Trailing `catch` syntax** with lowest precedence. Mechanically a parser change; semantics on the no-lambda form unchanged from today.
2. **Recovery-lambda form** with kwarg destructuring of tag args. Type agreement enforced at the lambda's return.
3. **Uncaught tag → CAM payload** with RPN cause chain. Replaces today's "uncaught is a runtime panic" with structured propagation.
4. **Trace capture** behind a policy flag — per-tag or build-mode, picked later. Receiving syntax is free.
5. **Cleanup-on-unwind** — defer the question until there's a resource that needs it.

## Addendum (2026-05-12): enumerated throws and the `throw` statement

The model gets sharper if escaping tags are declared in the function interface, and if `throw Type(...)` exists as a typed sugar over hash-tag invocation.

### Escape, not throw, is the axis

A tag invoked and caught within the same function is private control flow and does not belong in the interface — `#break` inside a `repeat { ... } catch #break` never escapes, so the function's signature stays clean. A tag whose throw site has no matching enclosing `catch` is in the function's **escape set**, and the declared `throws` clause must contain it (or be a superset).

```brevity
@div : (a Decimal, b Decimal) -> Decimal throws #error
```

A small escape pass over the body computes the actual set; the compiler checks that the declared set agrees. This keeps annotation friction proportional to real cross-boundary surface area — most catches are local, so most signatures stay empty.

### `throw` as typed sugar

`throw Error("not found")` desugars to `#Error(Error{message: "not found"})` — **the tag *is* the type**. The catch side picks it up using the same kwarg destructuring already used for ad-hoc tags:

```brevity
result = lookup(id) catch Error (message:) -> log(message)
```

Enumerated throws then become typed:

```brevity
@lookup : (id Text) -> Item throws Error, Timeout
```

Untyped hash tags (`#terminate`, ad-hoc signals, the cheap control-flow tags) keep working with arbitrary Structure args. `throw` is the surface for the typed case where you want a declared name and a schema to coincide. One mechanism, two ergonomic surfaces.

### Enforcement scope: boundaries declare, interiors infer

Java's checked-exception pain is the requirement that *every* function annotate. Brevity can scope the requirement to public actor boundaries — `@` methods, CAM-facing functions — and infer escape sets for private/protected functions. This matches the "queues at runtime boundaries, direct calls within" framing from `self-send-vs-direct-call-2026-05-09.md`: external callers see a declared contract, internal callers see inferred sets propagated through the call graph.

Open: whether `#error` is required in the public signature or whether it's implicit (every public function may throw `#error` by default). Implicit is more ergonomic but weakens the documentation value of the `throws` clause. Probably better to require it explicitly and let the compiler generate a one-line fix on missing annotations.

### Resulting model

- `#tag(args...)` — invoke a hash tag. Throws. May carry arbitrary Structure args.
- `throw Type(...)` — sugar for `#Type(Type{...})`. Typed, declared, schema'd.
- `catch #tag (kw:) -> ...` — recovery at a join point.
- `throws #a, Type, ...` on a function signature — enumerates the escape set. Required on public boundaries, inferred privately.
- Compiler verifies declared set ⊇ inferred escape set; flags missing entries with a one-line fix.

## Addendum 2 (2026-05-12): `#` *is* throw, and the runtime/CAM bifurcation

Tightening the model further: `#` is the throw operator. There is no separate `throw` keyword — `#break` *is* "throw break," and `throw Error(...)` from the prior addendum is just sugar for `#Error(Error{...})`. The whole construct unifies around one token.

The natural consequence is a clean bifurcation between intra-runtime and cross-CAM throws.

### Bare-label throws (runtime-local, unchecked)

```brevity
{ #break } catch(break)
```

- Lowercase (or otherwise non-Type) name → bare label.
- No type declaration anywhere.
- **Cannot escape to CAM.** Escape analysis enforces: a bare-label throw whose escape set is non-empty is a compile error — catch it locally or convert it to a typed throw.
- The `catch` side names the label without `#`, since `#` means "throw this" and the catch isn't throwing. `catch(break)`, `catch(done)`, etc.

These are the cheap control-flow tags: `#break`, `#continue`, `#return`-style locals. They don't pollute signatures because they provably can't reach the boundary.

### Typed throws (cross-CAM, schema'd)

```brevity
::Exception = (message: Text)

{ if cond #Exception(message: "fail") }
```

Travels CAM as:

```
{id: "123", ex: {message: "fail"}, bv-a: "Exception"}
```

- The tag *is* the Type — the name in the `#` is the Type name.
- The payload is an instance of that Type.
- Receiver imports the Type and catches with a typed binding:

  ```brevity
  *(Exception:) {
    { remote_call } catch (e Exception) { e.message }
  }
  ```

- The wire format reuses Brevity's existing typed-Structure encoding (`bv-a` carries the Type name, `ex` carries the payload). No new wire mechanism — exceptions ride the existing rails.

Case probably does the throw-site disambiguation: lowercase `#break` = bare label, capitalized `#Exception` = Type reference, matching Brevity's existing convention.

### `Error` is built in

`Error` is a stdlib Type, likely carrying special capabilities (backtrace, source location, possibly cause chain). Users get the easy path — `throw Error("...")` — without per-project boilerplate, and `#error` (bare, lowercase) remains available for runtime-local flagging.

### Declarations are exhaustive, not implicit

Open question from the prior addendum: should every remote-callable function implicitly carry `throws Error`?

**No.** Implicit Error undermines the value of the declaration — `throws` is load-bearing only if it's accurate. The contract is exhaustive: every public function's `throws` clause includes every Type that can escape from the body, transitively, including from callees not explicitly caught.

```brevity
{ (args) -> (result) throws (Quit, Redirect) }
```

The compiler computes the inferred escape set precisely (whole-program analysis is already a Brevity property) and emits a one-line fix when the declared set is incomplete: "callee X escapes Y, add Y or catch it." Friction is proportional to refactoring depth, not to ambient anxiety.

An **empty `throws ()`** (or omitted clause) is a real, checkable property — a function whose body provably has no escape set has the empty clause. Pure compute, deterministic transforms, and any function that catches everything it calls qualify. Most public functions won't be empty, but the empty case isn't a fiction.

### Application errors vs system faults

"Any remote call might fail" is true, but those failures — peer died, connection lost, scheduler timeout, OOM — aren't really `Error` material. They're **system faults**, handled by supervision (restart, escalate, rebind) rather than catchable application code.

The bifurcation:

- **Application errors** (`Error`, `NotFound`, `Conflict`, user-defined Types) — declared exhaustively in `throws`, caught locally where recovery makes sense.
- **System faults** — travel a different channel (`#cam_fault` or supervision-tree semantics, depending on the CAM model). Not in `throws`. Not catchable as `Error`.

A remote call's signature lists what the peer might *surface* (`NotFound`, etc.), not what could go wrong with the connection. That keeps `throws` honest without forcing every signature to list "could be killed by an asteroid."

### Widening vs exhaustive enumeration

If Brevity grows a type hierarchy where `NotFound <: Error`, then `throws (Error)` becomes a deliberate widening — "any kind of Error" rather than enumerating each subtype — and `catch (e Error)` on the receiving side handles the whole subtree. Allowing widening is ergonomic; requiring exhaustive enumeration even when a parent would cover it is maximally explicit. Both are defensible; pick later, after we know whether Brevity has nominal subtype relationships among Exception Types or not.

### Alternative catch destructure shape

The user flagged `catch (:message Exception) { message }` as a possible alternative to `catch (e Exception) { e.message }` — kwarg-style destructure-on-bind. Same question, separate topic — belongs to wherever Brevity settles destructuring shape on parameter binding in general, not to the exception model specifically.

### Resulting model (revised)

- `#name(...)` — throw. Lowercase = bare label (runtime-local, unchecked, cannot escape). Capitalized = Type (can escape, schema'd).
- `throw Type(...)` — sugar for `#Type(Type{...})`. Equivalent.
- `catch(name) ...` — catch bare label by name.
- `catch (e Type) ...` — catch typed throw, binds instance as `e`.
- `throws (Type, Type, ...)` on a public function signature — exhaustive list of typed escapes, transitively closed over uncaught callee throws.
- `throws ()` or omitted — provably no typed escapes. Checked, not assumed.
- Bare labels never appear in `throws` clauses (compile error if they could escape).
- System faults (CAM-level) travel a separate channel and are not part of `throws`.
- `Error` is a stdlib Type, available without import, possibly with backtrace capabilities.
