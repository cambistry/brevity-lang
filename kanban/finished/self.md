---
created: 2026-04-29
---
# Self

```
Chatter = <> {
  news List! = []
  @news = { news }
  @peer Self | null! = null
  @add = |t Text| {
    news.append!(t)
    if (peer) peer.gossip(t)
  }
  @gossip = |t Text| { news.append!(t) }
}

a = Chatter()
b = Chatter()
a.peer = b
b.peer = a
a.add("breaking news")
a.news == ["breaking news"]
b.news == ["breaking news"]
b.add("this just in")
a.news == ["breaking news", "this just in"]
b.news == ["breaking news", "this just in"]
```

reverse:

```
<list List>
=
@reverse = {
  first = List.first(list)
  rest = List.from(list, 1)
  child = Self(rest)
  rev = child.reverse()
  -> List.append(rev, first)
}
```
