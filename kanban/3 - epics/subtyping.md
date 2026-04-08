Positional args:

T = <a Integer>
U = <T | b Integer>
u = U(1, 2)
u.a = 1
u.b = 2

---

Named args:

T = <a: Integer>
U = <T | b: Integer>
u = U(a: 1, b: 2)
u.a = 1
u.b = 2

---

Invoke inherited public and private functions:

T = <> { a = { 1 }; @b = { 2 } }
U = <T |> { @c = { a + @b } }
U().c == 3

---

Inherit / extend public functions:

T = <> { @a = { "a" } }
U = <T |> { @b = { "b" } }
t = T()
u = U()
t.a == "a"
t.b // compiler error
u.a == "a"
u.b == "b"

---

Override public functions:

T = <> { @a = { 1 } }
U = <T |> { @a = { 2 } }
T().a == 1
U().a == 2

---

Inherit protected functions:

T = <> { x = { "x" }; @a = { x() } }
U = <T |> { @b = { x() } }
T().a == "x"
U().b == "x"

---

Override protected functions:

T = <> { x = { 1 }; @a = { x() } }
U = <T |> { x = { 2 } }
T().a == 1
U().a == 2

---

Private functions:

T = <> { #x = { 1 }; @a = { #x() } }
T().a == 1
U = <T |> { @b = { #x() } } // compiler error

---

Access supertype public function on wrapped instance:

T = <> { @a = { 1 } }
U = <T *sup |> { @a = { 2 }; @b = { sup.a } }
U().a == 2
U().b == 1

---

Access supertype public function on sugared instance:

T = <> { @a = { 1 } }
U = <T* |> { @a = { 2 }; @b = { T.a } }
U().a == 2
U().b == 1

---

Override arg must not change type:

T = <a: Decimal>
U = <T | a: Integer> // compiler error
V = <T | a: (b) Decimal> { @c = { b } } // retains type - ok

---

Accessors must not change types:

T = <a: :b Integer> // mapped to different accessor
U = <T |> { @b = { "b" } } // compiler error
V = <T |> { @a = { "a" } } // but this is legal, because T doesn't have an @a accessor (mapped)

Applies to public functions as well:

T = <> { @a = { 1 } }
U = <T |> { @a = { "one" }} // type change -- compiler error

---

Open design question... access supertype protected function on wrapped instance:

NOT FOR CURRENT IMPLEMENTATION.

T = <a: Integer> { a = { 1 } }
U = <T *sup |> { a = { 2 }; @b = { sup::a } }
U().a == 2
U().b == 1

