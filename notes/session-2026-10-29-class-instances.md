# Every class instance gets its own state (rust, erlang) — 2026-10-29

IMPLEMENTED. Resolves `class-instances-flattened-2026-10-29.md`.

On rust and erlang an ordinary class compiled to one shared (flattened) state
on its parent; only classes referring to `Self` got per-instance state. Now
every named class uses the per-instance path. The flattening optimization is a
backlog ticket (only where a class is provably constructed once and its ref
never escapes).

Tests: full rust, erlang and js suites green (run by the user, after flushing
`rust/cache` and `rust/w7/target` — a scratch build into w7's target dir had
cached wrong binaries). My scoped runs first missed `keywords` and
`functions`, where emit / subscribe / self-as regressed; fixed below.
`classes/instances` (two handler-local instances, two constructor-block
cells, a list of instances) and the lambda-tail cases in
`destructure/remote_call_binds` now pass on all targets.

## Rust

- Instance ref = `Value` string `"<class>/<id>"` (`bv_inst_ref`,
  `bv_inst_id`). `child_dispatch` routes it to `child_<c>_dispatch_at`, or to
  the plain dispatch when it is the instance already dispatching (its state
  is swapped in; its pool entry is empty).
- Construction yields a fresh instance in handler statements (typed and
  untyped), expressions (list literals, args) and constructor-block cells
  (`main()` stores the ref in the cell).
- Calls, bare field reads, `<-`, positional+named sets, field sets and
  subscriptions route through the instance. The `over` special case reads the
  class from the ref (ids are per class, so probing pools was ambiguous).
- Subscription slots moved off `state` (swapped per instance) to `sub_slots`.
  A slot callback is host code, so `dispatch_sub` queues while any instance
  is dispatching (`inst_depth`) and `flush_pending_subs` runs it once host
  state is back.
- `emit` is a runtime registry (`emit_subs`, keyed by emitter instance ref):
  `on <param>.<event>` registers the subscriber instance at its init; the
  emitter dispatches to each (first reply for a non-silent emit).
- `x T = inst` (`as`) dispatches to the instance.
- Test introspection resolves `target` paths through instance refs.
- Child-class handlers see class param / state types (from the earlier
  published-params commit).
- Fixed on the way: untyped `x = inst.m(args)` fired and forgot; omitted
  optional constructor args emitted a bare `null`; per-instance init called a
  missing child init for classes with no params/state.

## Erlang

- Every named class runs as its own process (`start_internal_<c>`,
  `bv_loop_<c>`); the process records its class (`bv_self_class_`).
- Constructor-block cells hold the instance pid — file level, inside classes,
  and `*`-constructed refs. The file's and each class's handlers dispatch those
  cells as spawned refs.
- `child_dispatch` accepts a pid; a self-call runs in place (messaging itself
  would deadlock).
- `<-` (statement, if block, inline lambda), positional+named sets and bare
  field reads on instances go through `bv_inst_call_`.
- Construction waits for the instance's init (`bv_spawn_sync_`) so the
  registrations it makes complete before the constructor returns.
- Subscribing to an instance field goes to its process (`bv_inst_sub_`); its
  notifications return as `{bv_notify, ...}` and run the stored fun after each
  instance call (`bv_drain_notify_`) and in the read loop.
- `on <param>.<event>` registers with the emitter instance (`bv_on_`); emits
  reach subscribers with the `__emit` caller (`bv_inst_emit_`).
- `x T = inst` (`as`) goes to the instance.
- Test introspection walks pids via `bv_inst_get_` and a `bv_get` loop clause.

## js

- A call on a constructor-block child read a bare local instead of its field.

## Representation note

rust refs are strings `"c/3"`; erlang refs are pids; js refs are objects. A
ref that leaves the actor on the wire is not addressed by this change.
