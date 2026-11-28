---
created: 2026-11-27
---
# Element writes and `<!` should derive from a collection presentation

Design: `notes/file-views-and-codecs-2026-11-27.md`, "Element focuses are derived" and "`<-` replaces; `<!` merges". Depends on
`a-named-presentation-is-reached-with-double-colon`.

```brevity
ls *Lines = Lines("a\nb\nc")
ls[1] <- "x"                         // get the list, replace one, set it back
md::FrontMatter.status <- "done"
md::FrontMatter <! status: "done"    // set(merge(get, new))
ls[1] <- "p\nq"                      // fails: Lines' set throws
```

Want: a List- or Map-shaped presentation gives element reads and writes, and `<!` on a Map, with
no declaration. `<!` is a new operator. A `set` that throws fails the whole write. Every target.
