---
status: done
created: 2026-11-02
---
# `as` must render or fail at runtime

  **Problem:** as should force a type interpretation or rendering that can fail at runtime. Today that only happens when an actor is bound to a typed name (n 

  Integer = c). That form sends [Integer, "as"], and the actor renders the value through its self as clause. The as keyword itself only changes the outgoing

  tag.

‌

  **Current behaviour:**

‌

1. **On a value, as relabels on all three targets.** Nothing converts and nothing fails.

‌

  brevity

  return "x" as Integer     // replies "x" tagged Integer

  return "42" as Integer    // replies "42" tagged Integer

  return 42 as Text         // replies 42 tagged Text

  return 1.5 as Integer     // replies 1.5 tagged Integer

1. **On an actor, as never asks the actor.** return c as Integer doesn't send the as message, even when c has the clause. The reply is tagged Integer but

     holds {} on JS, null on Erlang and "c/1" on Rust.

1. **Rust substitutes default values instead of failing.**

- x Integer = f() as Integer, with f returning "x", gives 0. A following x + 1 gives 1. JS and Erlang keep "x" and fail at the +.

- n Text = c, where a local class has no Text clause, gives "". n Integer = c with no clauses at all gives 0. JS and Erlang fail with error.

1. **Some forms fail cargo build on Rust with E0308, instead of giving a Brevity error.** These are x = "x" as Integer then return x, return "x" as Point, and

     x Integer = v as Integer on a (v Integer | Text) param followed by x + 1.

‌

  **Why it matters:** The return-path check accepts x T = f() as T without judging it, on the basis that as will settle it at runtime. Until as can fail, that

  form just mislabels the value.

‌

  **To decide:**

- **Value renderings:** which conversions exist? For example, is "42" as Integer the number 42 or a failure? Is 42 as Text allowed, and is 1.5 as Integer a

    truncation or a failure?

- **Type values:** what does "x" as Point do? Does a value that already has the fields of a Type pass?

- **Failure:** what does a failed as produce? Options include an ex reply on the enclosing call, and it needs a decision on whether catch can handle it.

- **Annotations:** does a bare x T = f() also check at runtime, or only as?

- **Compile time:** should a provably wrong as, such as "x" as Integer on a literal, be a compile error?

‌

  **Required regardless of those decisions:**

- c as T on an actor sends the as message, the same as n T = c.

- An actor with no matching clause produces a failure on every target.

- Rust never substitutes a default value for a failed as or a failed typed bind.

- Every form that compiles also builds on Rust.

‌

  **Check while doing this:** x Integer = Svc.t() as Integer with a Text reply came back as "x" tagged Integer on JS. It hasn't been tested on Rust or Erlang.

‌

  **Out of scope, separate bug:** a param typed Anything refuses a Text-tagged argument with unhandled on all three targets. The cause hasn't been traced.

‌

  **Done when:**

- Each case above renders or fails the same way on JS, Rust and Erlang, with tests in \_\_tests\_\_/types/type_coercion.test.js.

- Tests cover a wrong value from a local call, a remote reply and a param, and confirm that no failed as reaches later code as a tagged value.

- The SYNTAX_CRIB.md line "takes your word for it; nothing checks at runtime" and the "as is the escape, and it's unchecked" section of 

    notes/session-2026-11-01-return-shapes.md are corrected.
