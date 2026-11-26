---
created: 2026-04-27
---
# onclick handler

```
component = <> {
  count Integer! = 0
  @onclick = { count <- count + 1 }
  <div><h1>CLICK ME</h1><p>{ count }</p></div>
}
```

Catches event on any member of the component. First pass: no |event| payload (until we get BV Types working).
