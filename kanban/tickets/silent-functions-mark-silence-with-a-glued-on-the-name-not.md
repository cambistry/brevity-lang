---
status: done
created: 2026-10-30
---
# Silent functions: mark silence with a glued . on the name, not a terminating . in the body

  **Silent functions: mark silence with a glued . on the name, not a terminating . in the body**

‌

  A silent function (one that replies with nothing) is currently marked only by a . at the end of its body: sfn = 

  (arg) { do_something . }. That mark is easy to miss. This ticket moves it to the function's name and makes the call

  site explicitly fire-and-forget. Bang (!) functions don't change in this pass.

‌

  Design: notes/silent-dot-suffix-2026-10-30.md (only the silent-function parts apply here).

‌

  **Definition**

- A silent function is named with a . glued to the end of its name, with no space: sfn. = (args) -> body, sfn. = 

    (arg) { body }, \@sfn. = { … }, and in the lineal form a sfn. header.

- A .-named body is silent because of its name. Its final value is discarded, and return value is a compile error.

- **The terminating . is no longer allowed in a function body.** { do\_something . } and -> do\_something . become compile

    errors, and the message should name the fix ("name the function sfn. and drop the trailing .").

- The suffix and the silence are enforced in both directions: a .-named function must have a silent body, and a

    function can only be silent if its name has the ..

- A lone . line that closes a lineal class definition (. followed by end#Name) is unchanged and still supported.

‌

  **Invocation**

- A silent call must end with ... (fire-and-forget): sfn.(args)....

- When the ... comes directly after the name, it absorbs the dot: write sfn.... sfn.... is an error ("write

    sfn..."). In every other position the dot is written.

- Calling a silent function without ... is an error ("silent call — add ...").

- Using ... on a function that returns a value is an error ("fn returns a value; ... needs a silent fn.").

- fn and fn. may both be defined in the same namespace. The . is part of the name everywhere: in references, wire op

    names (@fn and \@fn. are different ops), service docs and imports. Because ... is illegal on a value-returning

    call, fn... always resolves to fn..

- The reference-field fire-and-forget form v.ref! becomes v.ref.... It is a call to a silent reference, not a bang

    function, so it belongs in this ticket. v.ref! becomes an error that names the new form.

‌

  **Type declaration**

- The silent type stays (args) -> ..

- Service docs and interfaces show the suffix on the name too: sfn. (arg) -> .. The repetition is accepted.

‌

  **Lexing**

- After an identifier, the lexer counts the run of dots that follows it:

- name.member: member access, as today.

- name. followed by anything else: the suffix, absorbed into the identifier (the same way a glued ? is absorbed

      today).

- name...: the identifier followed by an ellipsis. This resolves to name..

- name.... or name..: an error.

- A spaced x . is no longer a function terminator anywhere.

- A glued x. at the end of a statement becomes the suffix. Corpus check (2026-10-30): no glued terminators exist.

- A . after ) (f().) is not a suffix.

‌

  **Out of scope**

- Bang functions: the -> ! type, call-site bfn!..., != priority, and the bang-returns-self glyph.

- Call forms without parens (sfn. a ...).

‌

  **Migration**

- Every silent function in tests, docs and examples gets renamed to name., has its terminating . removed, and has

    its call sites rewritten with ....

- The corpus has about 254 spaced x . occurrences. Some are function terminators to migrate and some are lineal

    class closers to keep, so they need to be sorted case by case.

- **Open:** class set handlers (set = n Integer = value <- n .) are silent. Decide whether they become set. or whether

    set is exempt as a built-in op name.

‌

  **Tests**

- Each new error above.

- Elision: sfn... passes and sfn.... is rejected.

- fn and fn. coexisting, with fn... resolving to fn..

- A lineal class closer . is still accepted.

- Wire op names carry the suffix.

- All targets (js, rust, erlang).
