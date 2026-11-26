# Files as addressed values — 2026-11-25

Concept, a potential direction; not decided or implemented. Came out of asking what file access
in `kanban/board.bv` should look like. Builds on `use-as-binding-2026-11-18.md` (binding,
destructure, backticks as implicit `use`), `backticks-as-dynamic-names-2026-04-16.md`,
`callable-files-2026-04-14.md`, and the Object as the arguments-and-replies shape
(`xml-construction-named-only-2026-10-26.md`). Answers the empty `file-system` ticket.

## The idea

Brevity is built on an addressable file system, and data files should take part in it, not only
`.bv` files. A file is addressed like any dependency, and it answers like a call: **one
positional value, its contents, plus named entries.** Binding follows the existing rules: a plain
name takes the positional value (as `x = f()` takes a reply's one positional value), and `:name`
takes a key.

```brevity
use done *Lines = "../.kanban/lists/done"              -- contents
use :file = "../.kanban/lists/done"                    -- file-system metadata
use done *Lines, :file = "../.kanban/lists/done"       -- both
```

So the data never shares a namespace with metadata: `done` is the contents and nothing else, and
`done.modified` doesn't exist.

## The contents are a cell

A file's contents are a value at an address that can be read, rebound and watched, which is what
a cell is:

```brevity
cards = done                  -- read (a message to the host; async)
done <- paths                 -- write: replaces the contents
sub done, (paths) { … }       -- watch
```

`*` makes the contents writable; without it they are read-only. Anything richer than read, write
and watch (append, atomic replace) is a message on the file's address, as `grid.append!` is on a
cell.

## Formats

- **The default is Brevity's own serialization.** A typed file with no format round-trips any
  value; a text containing a line break survives.
- **A plain-text format is named as a format type:**
  - `Lines`: a `List[Text]` stored one item per line. An item containing a line break can't be
    written; the write fails, never silently splitting.
  - `Json[T]`: a `T` stored as JSON.
  - `FrontMatter`: a Markdown body with front-matter fields.
- **A format is a pair of functions,** decode and encode, so a library can define new ones. The
  host deals only in bytes and Text.
- **An untyped file is `Text`.** `Blob` when bytes are wanted, stated.

## Named entries belong to the format; file-system metadata is `:file`

The format owns the named lane. A front-matter file's positional value is its body, and its named
entries are its front-matter fields:

```brevity
use body, :status, :created = "../kanban/tickets/x.md"
status <- "done"              -- rewrites that field, nothing else
```

File-system metadata is always under one reserved key, `:file`: an Object of `path`, `modified`,
`created`, `size`, `exists?`. It never collides with a format's keys (a ticket's `created` is
front-matter; `file.created` is the file system's), and reaching it is one step: `file.modified`.

**Writes touch only what they name.** Writing a plain value replaces the positional value and
leaves the named entries alone, so editing a ticket's body can't damage its front-matter. Writing
an Object, `("# Title\n", :status, :created)`, sets the entries it gives.

## Directories

A directory is an Object keyed by filename: each entry is a file, answering as above.

```brevity
use lists Dir[*Lines] = "../.kanban/lists/*"
use tickets Dir[*FrontMatter] = "../kanban/tickets/*.md"

paths = lists[status]                    -- one file's contents
lists[status] <- paths                   -- write (creates the file if new)
over(tickets.keys) (slug) { … }          -- list
ticket = tickets[slug]                   -- body; `tickets[slug].status` a field
tickets[slug].status <- "done"           -- write one field
lists.remove!(status)                    -- delete: a message on the directory
sub lists, (change) { … }                -- watch the directory
```

- **The glob is the grant and the key.** `"…/tickets/*.md"` grants every `.md` file there, and
  each key is what `*` matched: the slug, without `.md`.
- **Dynamic paths stay auditable.** A backtick address is an implicit `use`, hoisted into the
  manifest, but `` `…/lists/#{status}` `` can't be listed statically. A directory grant covers
  it: the manifest says "this file may touch `.kanban/lists/*`", and `lists[status]` stays
  inside. An interpolated backtick path outside every granted prefix is a compile error.
- **Backticks remain for one-off access** to a literal path or one under a grant.

## What `board.bv` loses

The `Files` service; the list-filter-read-parse loop in `Tickets.@load!`; the front-matter regex
helpers (`field`, `bodyOf`, `FRONT_MATTER`); `@restatus.`'s whole-file rewrite; the list-file
read and join in `Column` and `Board.@write.`; the `Editor`'s front-matter split and rejoin; and
`Ticket.path`. The `Sync` actor stays: git is a process, not a file.

## Open questions

- **Concurrency.** Two actors writing one file: does a host actor per file serialize them through
  its mailbox, as `Sync` serializes git?
- **Watch granularity.** What does `sub` on a directory deliver: the changed key, or the whole
  Object?
- **Metadata writes.** Is `:file` read-only, or can some entries (`modified`) be set?
- **Scratch files for other programs.** The editor needs a real path. A host-provided scratch
  directory (`use scratch Dir[*Text] = "host/tmp/*"`) with `file.path` covers it; is that the
  right shape?
- **Format and key typing.** Should a `FrontMatter` file declare its fields' types
  (`FrontMatter[(status Text, created Text)]`), so `tickets[slug].status` is checked?
