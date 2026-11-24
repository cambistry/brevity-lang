---
status: done
created: 2026-04-09
---
# DI constructor / file-as-constructor

How to “spawn” a file actor:

[thing.bv](http://thing.bv "‌")

```
<> { @get = "constant" }
```

client script:

```
<"thing.bv": (Thing) #> // hash is the generic constructor type
=
t = Thing()
```

```
<"thing.bv": Thing#> // shorthand
```

```
<"thing.bv": (Thing) <:a Integer> -> { get: () -> (Integer) }> // explicit call/service signature
```

```
// partial declarations (not v1 if ever)
<"thing.bv": (Thing) # -> { get: () -> (Integer) }>
<"thing.bv": (Thing) <:a Integer> -> *>
// not sure how useful this is -- either you are pulling in the interface or not
```

```
<"thing.bv": (Thing) #>
// coercion
Coerced = Thing as <:a Integer> -> { get: () -> (Integer) }
```

‌

/a.bv

```
<:a Text> { @get = -> a }
```

```
<"/a.bv": (A) #>
=
a = A("hello")
```
