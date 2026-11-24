---
status: todo
created: 2026-04-27
---
# Nested reactivity

parent:

```
@names List of Texts! = []

<div>
  { over(@names) |name| <component name={ name } /> }
</div>
```

component:

```
<:name Text> {
  <p>{ name }</p>
}
```

I think this somewhat works.

The outer closure inside of <div> subscribes to \@names, and republishes if that changes. The thunk gets evaluated by the parent, returning a NEW list of components - old ones are (should be) garbage collected.
