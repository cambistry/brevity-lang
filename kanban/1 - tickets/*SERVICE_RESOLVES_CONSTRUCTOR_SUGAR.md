The service report should unambiguously represent the contruction params and the public functions.

X = <a Integer>

X <Integer> -> { a: () -> (Integer) }

---

Mapping:

X = <a: :b Integer>

X <a: Integer> -> { b: () -> (Integer) }

---

Sugar:

X = <
  a Integer
  @get = { a }
>

X <Integer> -> { get: () -> (Integer) }

