---
status: inbox
created: 2026-11-14
---
# Lineal rethink?

Aim to tolerate LF…

‌

```
\**
  <DI>
\**

count *Integer = 0

  new =
  \*
    params
  \*
  constructor

  @fn =
  (
    params
  )
  body

  @A =
  \**
  sub-constructor
```

The principle here seems to be that a lineal header (no assignment) opens up a singleton/constructor/function for the full file.

A file with no header implicitly opens a singleton:

```
new = *{

}

other class functions / names
```

‌

LF termination applies to anything that is assigned to a name inside of a file, which can be overridden with end#Name, enabling internal LF.
