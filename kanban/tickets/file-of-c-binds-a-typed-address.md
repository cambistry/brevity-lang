---
created: 2026-11-27
---
# `File[C]` should bind a typed address and lower each use through `C`

Design: `notes/file-views-and-codecs-2026-11-27.md`, "What runs where" and "The file is parameterized by what it holds". Depends on
`file-should-be-a-host-actor`, `a-write-needing-the-current-value-is-a-versioned-write` and
`element-writes-and-merge-derive-from-a-collection-presentation`.

```brevity
columns = File[Lines]("./columns")
specs List[Text] = columns            // read, through Lines' self as
columns[3] <- "x"                     // versioned write through Lines' set
lines, :created_at = File[Lines]("./columns")   // a destructure: values
```

Want:

- `File[C](…)` evaluates to a typed address: the File's address and the static type `C`. No
  message is sent at the binding.
- Each use lowers through `C`'s functions on the program's side. The host never runs them.
- `C` must wrap the File's storage (Text), so `File[List[Text]]` is a compile error.
- Plain `File` is `File[Text]`.
- A destructure or typed bind is a read; binding it whole is live.

js, erlang, rust.
