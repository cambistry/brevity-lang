---
status: done
created: 2026-05-02
---
# Lineal header syntax rethink / cleanup

The invariant in headers is that params _must_ each be declared on their own line. For functions the pattern is:

```
ident \n? (=
...params)?
=
body
```

Functions:

```
fn
=
...params
=
body

fn =
...params
=
body
```

Parameterless functions:

```
fn
=
body

fn = // not valid. this is just assignment of the next line.
body
```

Lineal function declaration requires the delimiting equal sign to be entirely on its own line, since there is no other context to leverage.

For constructors, the pattern is:

```
Cls \n? = \n? <
...params
> \n? =
body
```

In other words: lineal constructor syntax is the same as function syntax with the addition of the <> brackets. Classes:

```
Cls
= <
...params
>
=
body

Cls =
<
...params
> =
body

Cls = <
...params
> =
body
```

**Lineal headers with delimited body:**

```
fn =
...params
{
}

Cls = <
...params
> \n? {
  body
}
```

When switching to a delimited body, the closing equal sign is not used (is a compiler error). Of course, not the case with a parameterless function:

```
fn
=
{ body } // legal
```

**Delimited header (commas) with lineal body:**

```
fn = |a, b ...|
=
body
```

The key, I think, is that there is a LF after the body-opening equal sign.

```
fn = |a, b ...| =
body // this is fine!

fn = |a, b ...|
=
body // this is fine.

fn =
|a, b ...| = // multiple params require vertical bars.
body

Cls = <a, b ...> =
body // also fine!

Cls = <a, b, ...>
=
body // also fine.

Cls =
<a, b, ...>
=
body // also fine.
```

The general rule: end-of-line equal sign after a header opens a lineal body (no curly braces). Can be on its own line, or can just be trailing. Key change: a lineal constructor would require an opening equal sign (or overload operator <<).
