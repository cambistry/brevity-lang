---
created: 2026-10-29
---
# Support class shorthand? `*(@a Type)`

i.e. no body

Only makes sense if there are public auto-constructors. Can be sub-actors:

```
C = *(@mutable *Text)
c = C("hello")
c.mutable <- "goodbye"
```

But note that the accessors would be spelled out in service doc:

`c (Text) → *{ mutable *Text }`

Investigate if this syntax would conflict with, say, an actorized type. Or would be too confusingly similar.

`*(mutable Text)`

That declares a type-cell.

But I’m not sure that is valid Brevity. Should be

```
::MyType = (mutable Text)
my_cell = *MyType
```

So perhaps a non-issue?

The other option is postfix:

`(@mutable *Text)*`

which posesses a certain positional logic, but also feels a bit quiet.

Or - maybe this should be kept ugly () → *{} because if the only thing a class is doing is holding and perhaps updating values, then just actorize a type, right???
