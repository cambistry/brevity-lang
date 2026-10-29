# Published params: `@name` opts a class param into an accessor — 2026-10-29

IMPLEMENTED (js / rust / erlang). Replaces auto-accessors. Follows
`session-2026-10-29-accessors-reply-positionally.md`. Exploratory: in to play
with; may be deprecated before v1 if it gets ugly in real code.

## Rule

Class and file params are private. `@` publishes one: the class answers
`@name` with the value, positionally.

```
Cls = (@accessible Integer, @bool: Boolean, quiet: Text) *{ … }

c = Cls(1, bool: true, quiet: "q")
a Integer = c.accessible()      // 1
b Boolean = c.bool()            // true
c.quiet()                       // compile error: 'Cls' has no method 'quiet'
```

- `@label: (l) Text` publishes under the label `label`, local `l`.
- File header: `* @count Integer *` publishes on the file actor.
- A published `*` param publishes the ref it holds (convenience). To keep
  write access internal, don't publish it; write a handler: `@arg = { arg }`.
- `@` matches its meaning everywhere else: public surface (`@handler`,
  `@cell *Type`).

## Why

Auto-accessors were an invisible public surface: every unsuppressed param got
a handler the service document never listed, and three param spellings
existed only to undo the default. Opt-in makes publishing a declaration.

## Decisions

1. Service document lists published params as read-only fields:
   `Cls (Integer, bool: Boolean, quiet: Text) -> *{ accessible Integer  bool Boolean … }`;
   file params at the top level.
2. Bare reads (`c.accessible`) are a general zero-arity principle, not done
   here. Today: works for a typed bind from a child actor; in expression
   position the type isn't inferred; on remote / dependency actors it's
   greenfield (reads `undefined`, sends nothing).
3. A published param and a same-named handler in one class is a compile
   error. A subclass may still override an inherited accessor (type kept).
4. Published `*` params expose the ref (see above).
5. Retired, parse errors with hints: `(name) Type`, `(name) :accessor Type`,
   `name: :accessor Type`, `name: (alias) :accessor Type`. `name: (alias) Type`
   (local alias) stays.
6. `@` on a function or handler param is an error.

## Implementation

- parser: `@` branch in `parseOneParam` sets `accessor` to the public name
  (`key || name`); file-header branch; function params reject `@`.
  `FileParam` carries `accessor` into the file actor's initParams.
- codegen (js `classes.js`, rust `handlers.js`, erlang `program.js`):
  an accessor arm only when `p.accessor`.
- validate: method sets and the call-shape check use `accessor`;
  `checkPublishedParams` rejects collisions and function-param `@`.
- service doc (`index.js`): `publishedParamLines`; also fixed `formatParam`
  rendering an aliased named param by its local name instead of its label.
- rust (found by the new tests): child-class handlers didn't know the class
  params' types, so `a + b` on Text params compiled as integer addition.
  Child handler type env is now seeded with param / state types.

## Related

- Ticket (drafted, not filed): declared read-only public fields `@name = expr`
  — would give `@arg = arg` instead of a handler.
- Types are the better tool for plain data; this is fine for simple apps.
