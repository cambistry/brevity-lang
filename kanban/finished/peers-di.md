---
created: 2026-04-28
---
# Peers DI

```
 Peer = <:name Text, :P List of Self!> {
  peers List = []
  P.subscribe = |p List| { peers <- p }
  @name Text! = "peer"
  @names = { over(peers) |p| { p.name } }
}
...
peers List of Peer! = []
peers <- [
  Peer(name: "Aaron", P: peers)),
  Peer(name: "Betsy", P: peers)),
  Peer(name: "Charlie", P: peers))
]
peers.first.names == ["Aaron", "Betsy", "Charlie"]
```

Note that this relies on dynamic address resolution. When Aaron traverses `peers`,the value of `p` will reduce to `self`, because of the way that addresses travel on “the wire”.

```
Peer = <:name Text, :P List of Self!> {
  @names = { over(P) |p| { p.name } }
}
```
