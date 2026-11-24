---
status: done
created: 2026-11-18
---
# `to`, `from` and `ty` are never bracketed

Summary

An address field (`to`, `from`) holds a bare address, and a `ty` tag a bare tag: never `#<…>`. Brackets mark an address *inside a payload* (an argument, a reply value). When code uses a received address value as `to`, it unwraps it. Dependency sends already follow this (`remote.bv:slot`, not `#<remote.bv:slot>`). Other paths don't.

Today

- A call through a reference value sends the value as received: `to: '#<x:p>'`, `to: '#<caller:cb>'` (__tests__/types/reference_fields, lambda_ref_invocation, destructure/remote_call_binds). On erlang, `bv_to_addr_` (preambles.js) already strips the brackets, so the targets disagree.
- The browser runtime accepts a bracketed `to` (route(), the `#<alias:sel>` form), and DOM tests send one: `$set` to `#<factory.bv:color>`, `#<sheet.bv:color>`, `#<factory.bv:count>` (html/reactive_element, style, onclick), and browser/dom_subscribes_to_children ("posts subscribe with to: #<alias:sel>").

Semantics

- Sending to an address value unwraps it: `#<x:p>` → `to: 'x:p'`. Quoted tokens stay quoted (`#<'a:b':p>` → `'a:b':p`).
- A received message whose `to`, `from` or `ty` is bracketed is malformed. The receiver rejects it (with an `ex` reply where there's an `id`) and never routes it.
- Unchanged: brackets inside payloads (`re: '#<svc.bv:1>'`, args).

Work

- One unwrap helper beside opre_tokens.js, used by every target wherever an address value becomes `to`: reference fields, lambda refs, callbacks, `$new` replies used as a target, subscribe/`$set` to a held address.
- Receivers on js, rust, erlang and the browser runtime reject bracketed address fields. Retire the browser's `#<alias:sel>` routing form and erlang's silent strip.
- Tests: move the assertions above to bare addresses; add the rejection case on each target (bracketed `to`, `from`, `ty`).
