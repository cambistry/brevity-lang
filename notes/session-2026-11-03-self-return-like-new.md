# Session 2026-11-03: a self-return replies like `#new`

A function that ends with `return self` (or a tail `self`) now gives the caller the same reply as
`#new`: the actor's address in `re`, its class's address in `bv-a`.

```
before:  { re: {}, 'bv-a': '#<@Counter/1>' }
after:   { re: '#<@Counter/1>', 'bv-a': '#<@Counter>' }
```

Before, `#<…>` in `bv-a` had two meanings: "re is an actor of this class" (reply to `#new`) and
"the value is this actor" (self-return). Design rules are in "Self on the wire" in
`mutation-suffix-2026-10-31.md`.

## Wire

- **Child:** `{ re: '#<>' }`, no `bv-a`, on every target. Delegated and early-return paths too.
- **Parent of an actor made by `#new`:** promotes `re` to `#<@Counter/1>` and adds
  `bv-a: '#<@Counter>'`. The class keeps a `!` in its name (`#<@Pub!>`).
- **Higher parents:** the existing translators already rewrite every local `#<…>` string, so `re`
  and `bv-a` are both translated with no change (`#<main @Counter>` under the browser harness).
- **DOM:** every node address is `HTML @kind/N`, so a node's self-return is
  `{ re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }` (`selfReply` in `browser/runtime.js`).
  Sub-reps follow the same rule (`#<HTML @classlist>`).
- **Callers:** a reply whose `re` is a `#<…>` string, and whose `bv-a` is absent or a `#<…>` with no
  `::`, is that actor (JS pending path, Rust `await_response`, Erlang `bv_self_reply_`).

## Where

- **JS:** `genReBody` / `genBvaBody` (`expressions.js`), `BvObject.splat` for delegated bodies,
  `delegatedBvaLine` and `#_publishInstance` (`classes.js`). The pending path's special case for
  `re: {}` with an address in `bv-a` is gone, since `_bv_unwire_reply` passes a string `re` through.
- **Rust:** `genRustReBody` / `genRustBvaBody`, `child_<c>_dispatch_at` checks `"#<>"` instead of an
  empty Object, the published-instance branch and `await_response` in `program.js`.
- **Erlang:** `genReplyBody` / `genBvaBody`, `makeErlDispatchRet`, the instance loops match
  `{ok, <<"#<>">>, _}`, `bv_forward_` names actor and class, and `bv_self_reply_`.

A side effect: on Rust and Erlang a self-return used to be detected by an empty Object, which an
empty `Object` spread return also produces. The marker is now distinct.

## Fixed on the way

- **Erlang:** a file whose only contents are public classes didn't answer `#new`. The active-actor
  filter counted `@`, `set` and `update` functions, not the synthesized `new@W`, so the class
  became the main actor. Found by the new tests in `public_class.test.js`.

## Not done

- **Private classes.** The ticket says an actor of a private class gets its class's label as the
  parent knows it (`#<Box>`, `#<#Box>`). Today those actors are in process only: the parent turns
  `#<>` into its handle and nothing goes on a wire, so there's no `bv-a` to write.
- **File actors** (browser scripts, the test harness's child) have no class, so their parent
  promotes `re` and adds no `bv-a`: `{ re: '#<main>' }`. The `document` actor's `normalize!` is the
  same: `{ re: '#<document>' }`.

## Tests

Updated: `bang`, `repeat_while`, `repeat_until`, `public_class_across_files`, `outer_reads`,
`own_published_cell`, `closure_child.browser`, `element.browser` (one `set_attribute!` case now
checks `bv-a: '#<HTML @div>'`). New in `public_class.test.js`: a self-return from an actor made by
`#new`, from an early return, and on a class named with `!`.

Run on js, Rust and Erlang: `bang`, `repeat_while`, `repeat_until`, `public_class`,
`public_class_across_files`, `outer_reads`, `own_published_cell`. Erlang also ran all of
`__tests__/classes/`. Browser ran `element` and `closure_child`. js ran `return_shapes` and
`actor_interface`. No full-suite run.
