At present, we have implemented `ref`, which wraps a core data type in a stateful cell.

```
ref a : Integer = 0
a <- 1
a == 1 // true
fn = (val : integer) ->  a <- val
fn(2)
a == 2 // true
```

This epic is about generalizing this language feature to declared actor types as well.

```
actor MyInt

init(val : Integer)
  $val = val .
  .

as Integer
  reply $val

on <- (val: Integer)
  $val = val
  .
```

The above is a manual implementation of the built-in language feature. Used exactly the same way as ref ... Integer was above:

```
ref a : MyInt = 0
a <- 1
a == 1 // true
fn = (val : integer) ->  a <- val
fn(2)
a == 2 // true
```

Note that the "=" (assignment) at the end of the ref statement is shorthand for a call to the init clause. The following would also work: `ref a = MyInt(0)`

An actor definition should be useable in the same file in which declared, e.g.

```
on double(x : Integer)
  ref i : MyInt = x
  i <- i : Integer * 2 // type casting invokes the `as` clause
  reply(i : Integer)

actor MyInt
  init(val : Integer)
    $val = val

  as Integer
    reply $val

  on <- (val: Integer)
    $val = val
    .

end#MyInt
```
