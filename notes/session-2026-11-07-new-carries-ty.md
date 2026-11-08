# Session 2026-11-07: `#new` carries `ty`, and is gated like any op

Ticket: "Type values can't cross to or from a class in another file." Resolves the two gaps in
`session-2026-11-01-public-classes-across-files.md`.

## What was actually broken

- **Replies (part 1) were already fixed.** A class's reply carries `ty` on every target
  (`["::Point"]` on Rust and Erlang, `["@W/1 ::Point"]` on JS), and the caller decodes it,
  probably since `11db67c`. The two targets name a different authority. Type matching ignores
  authority, so this works (point 5 in `session-2026-11-03-ty-without-brackets.md`).
- **The caller didn't compile.** `p Svc::Point = w.get()`, then `Svc.Holder(p)`, was refused:
  `'Svc::Point' is not assignable to 'Point'`. The doc names its own types bare. The same was true
  of any remote call: `Svc.take(p)` gave `expected Point, got Svc::Point`.
- **Constructor args (part 2) leaked `__type`.** `#new` sent the runtime's tagged object
  (`[[{"__type":"Point","x":1,"y":2}], "#new"]`) with no `ty`, on every target. The receiver decoded
  it by `__type`, so it worked by accident. `__type` must never be on the wire; that's what `ty`
  is for.

## Decision: `#new` is an op like any other

Every `#new` with args sends them in wire form, with a `ty` that mirrors the payload, built as for
any other call: `[[t…]]`, `[{k: t}]` or `[[t…, {k: t}]]`. A `#new` with no args sends `[]` and
no `ty`.

```
before: { op: [[{ __type: 'Point', x: 1, y: 2 }], '#new'], to: 'Svc @Holder' }
after:  { op: [[[1, 2]], '#new'], ty: [['svc.bv ::Point']], to: 'Svc @Holder' }
```

The receiver refuses a `#new` that has args and no `ty` as `schema_required`, and checks the
args' tags against the class params as for any op. A wrong type is `unhandled`. In-process
construction (`__parent`) passes values, not tags, and isn't checked, as before.

## Code

- **Validator (`src/validate.js`):** a constructor arg's `Svc::Point` is read as the doc's `Point`
  (`acceptsArg`). A remote call's arg types are read in the doc's frame (`inDocFrame` in
  `validateRemoteCall`).
- **JS:** `genNewArgs` / `genSendNew` in `expressions.js`, on `genArgSlots`. They replace four
  copies of the payload builder in `expressions.js`, `statements.js` and `classes.js`.
  `#sendNew(args, to, ty)`. The `new@` exemption is gone from the `schema_required` gate, and so is
  the skipped type condition on `new@` handlers.
- **Rust:** `rustNewArgs` / `rustNewOpInserts` in `expressions.js`, at the four compiled `#new`
  sites: in place, `genRustDepConstructorAssign`, `genRustDepConstructorAsAssign`, and a file cell
  set from a remote construction in main. The gate (`program.js`) and `childTagGuard` /
  the arm guard (`handlers.js`) no longer exempt `new@`.
- **Erlang:** `erlNewOpEntries` in `expressions.js`, on `erlArgSlots`, at its four sites. The
  `IsNew` exemption in the dispatch gate and the skipped `typeCheck` on `new@` are gone.

## Not changed

- **DOM `#new` in the browser.** The DOM host in `browser/runtime.js` gates no op on `ty`, so a
  compiled actor's DOM `#new` (`{children, attrs}`) still goes untagged, as its other DOM ops do.
  Gating the DOM host is its own question.
- **JS and Rust/Erlang name different authorities** for a type sent by an instance. Left as before.

## Tests

- **`__tests__/classes/public_class_across_files.test.js`:**
  - "end to end: type values cross to and from a class in another file", two compiled files
    through a relay that plays the parent (prefixing local addresses and local `ty` tags): a Point
    returned from `Svc.W()` decodes in the caller; one passed to `Svc.Holder(p)` decodes in the
    class; and the `#new` carries `[[[1, 2]], '#new']` with `ty: [['svc.bv ::Point']]`.
  - "the class replies with the value in wire form, and its ty": Svc's reply to `@get` is
    `re: [[1, 2]]` with a `ty` of `::Point`, whatever its authority. Added later the same day: the
    decode test alone doesn't cover part 1, because the caller decodes a reply by its own
    annotation (`p Svc::Point`) and still gets `1` with the reply's `ty` stripped. Nothing in the
    caller checks a reply's tags; whether it should is open.
  - "receiver side": "refuses args without a ty" and "refuses args of the wrong type".
- **Inputs and expected outputs given `ty`:** `public_class_across_files`, `instance_failure`,
  `enclosing_reads`, `payload_shape`.

`__tests__/{classes,types,cam,exceptions,functions,destructure,xml,core_types,self,constructors}/`
pass on js, Rust and Erlang, as do the browser tests that use `#new`.
