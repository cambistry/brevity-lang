---
created: 2026-11-27
---
# Design: an atomic write of several presentations

From `notes/file-views-and-codecs-2026-11-27.md`, open question "Creating a ticket takes two writes".

```brevity
tickets[slug] <- "# #{title}\n"
tickets[slug]::FrontMatter <- (:status, :created)
```

A watcher can see the file with a body and no front matter in between.

Decide: one write that sets several presentations, perhaps
`tickets[slug] <- ("# #{title}\n", FrontMatter: (:status, :created))`, a third shape for `<-`, or
another form.
