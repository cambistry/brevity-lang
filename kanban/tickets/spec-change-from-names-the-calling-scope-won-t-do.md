---
status: investigation
created: 2026-11-14
---
# Spec change: `from` names the calling scope

Every outgoing call (ordinary ops, silent `!` and launched calls, and the intrinsics $get, $set, $new, $subscribe, $update) carries in `from` the address of the innermost named, addressable scope whose code made it, relative to the sending actor and translated by each parent as `from` is today. Replies (re/ex) are unchanged.

Spec: notes/from-names-calling-scope-2026-11-14.md

Example (main.bv, header `HTML: (:div)`):

```
@template = { <div>123</div> }          -> $new to `HTML div`, from `. template`
@Constructor = *{ d = <div>456</div> }  -> $new to `HTML div`, from `. Constructor`
```

HTML receives from `main template` / `main Constructor`. Today both arrive as `main`.

Scope rules

- Function (@f, ~f, #f; lineal or braced): the function, in wire form (`. template`, `. ~helper`, `. #panel`).
- Class constructor block: the class (`. Constructor`), whether the class sends directly or the call is relayed through the file actor (src/outer_reads.js). The actor under construction may have no address yet.
- Nested class: `. Outer Inner`.
- Closure / lambda (incl. `{{ }}` holes): its enclosing named scope, not `. @N`.
- File-level code: the actor itself (`.` / `from` omitted), as today.
- Forwarding doesn't re-scope: in `@a = -> #b()`, calls made by #b carry `. #b`.

Reply routing

- A re/ex addressed to a function scope belongs to the actor holding that function; matched by id as now. The published-actor router must not claim it.
- A re/ex addressed to a class scope goes to the class, which keeps the pending table for constructions in progress and routes by id (ids unique per class). This replaces the file actor's id renumbering for relayed class calls (JS `_outerFwd`, Erlang `bv_outer_call_`).

Rule: `from` is a reply address only. Receivers never send a request to it.

Scope of work

- JS / Rust / Erlang: thread the current scope through codegen to every send site (JS #send/#sendNew/#sendRef/#childSend/#out; ~35 Rust binding.send sites; ~25 Erlang json_encode sites). Consider one message builder per target first.
- Class relay path: send under the class scope; move id routing from file actor to class.
- Check the outermost hop prefixes a relative multi-token `from`.
- Update the ~32 exact-equality outgoing-message expectations (7 test files) and the test relays that compute `from`; add tests for each scope rule and for reply routing to function and class scopes, on all three targets.

Out of scope: the DOM `creator` attribute (separate ticket), and methods called after construction (`. C make` vs `. C 1 make`; open in the note — implement constructor blocks and functions first).
