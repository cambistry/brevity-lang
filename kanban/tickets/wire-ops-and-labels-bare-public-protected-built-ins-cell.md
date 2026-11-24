---
status: done
created: 2026-11-13
---
# Wire ops and labels: bare public, ~ protected, $ built-ins, cell addressing

**Depends on:** kanban/tickets/opre-addresses-tokens-and-the-self.md

**Background.** Same design note. On the wire:

```text
┌─────────────┬─────────────┐
│    Wire     │   Meaning   │
├─────────────┼─────────────┤
│ name (bare) │ public      │
├─────────────┼─────────────┤
│ ~name       │ protected   │
├─────────────┼─────────────┤
│ #name       │ private     │
├─────────────┼─────────────┤
│ $name       │ built-in op │
└─────────────┴─────────────┘
```

The wire name is the name: source @get is named get, a bare source fn is named ~fn, and #x is named #x. The ops that combine a built-in with a label (set@val, subscribe@val, get@val, new@Good, set.val) are retired. The target moves into to.

**Scope.**

1. **Public ops drop @:** opre.js ('@' + member) and every target's dispatch tables. Wire ping dispatches to the source's @ping.
2. **Protected labels take ~:**
- wireLabel in src/codegen/wire_labels.js produces ~fn, ~val, ~_lambda_N. It leaves names starting with #, ~ or $ alone.
- Rust and Erlang choose a spelling for ~ in generated identifiers, replacing the _d_ used for ..
1. **Built-ins take $:** $get, $set, $new, $subscribe, $update, $as. These replace #new and #set and the bare built-ins listed in wire_labels.js's INTRINSIC set.
2. **Cell and class ops name their target in to:**
- {op: [[7], '$set'], to: '. val'} replaces set@val.
- {op: [[7], '$set'], to: '. ~val'} replaces set.val / to: '.val'.
- {op: '$subscribe', to: 'Box 1 val'} replaces subscribe@val.
- {op: [{}, '$new'], to: '. Box'} replaces #new / new@Box.

The per-label handlers collapse into one handler per built-in, which takes the remaining token of to as the cell or class. That includes the internal get@ reads a child makes of its enclosing actor (_outerGet). A built-in aimed at a token it doesn't apply to answers unhandled.

1. **Keys follow wire names:**
- Subscriber tables are keyed "a" / "~a" ("@a " / ".a" today) in JS, Rust and Erlang.
- Snapshot capture and hydrate keys follow suit.
1. **Reserved names:** a protected function named after a built-in (bare set) stays a compile error, because it's a source keyword. A private #set and a public @set are both allowed.

**Out of scope.**

- Changing what is subscribable or how cells are read (ticket 3). Whatever can be subscribed to today still can, via $subscribe to its address.
- The ex key detail (follow-up ticket).
- Who may send protected or private messages: the pseudo-sender check is unchanged.

**Tests.**

- Rewrite by script: about 1,645 op: '@…' sites, about 66 #new / #set sites, about 30 compound-op sites (ops and ex keys), and the recent .f / .val sites from the dot-prefix work.
- **Review the tests whose meaning changes by hand.** A bare op used to mean "not public" and now means public. Convert each of these to ~f before stripping @, so they keep testing what they test now:
- functions/public.test.js:124
- functions/public.test.js:145 (the test.op case)
- classes/public_class.test.js:385
- Add tests for:
- a private #set being allowed;
- $set to a token that isn't a cell answering unhandled;
- a protected ~val set from inside versus refused from outside.

**Done when.**

- No @ appears in any wire op or label the compiler emits.
- No compound built-in op remains in any target.
- Each target's suite passes.
- protected-names-dot-prefix-2026-11-11.md gets a pointer to the ~ spelling.
- classes-as-singletons-2026-11-09.md uses the new examples (main s get).
