# Files as addressed values — 2026-11-25

Concept, a potential direction; not decided or implemented. Came out of asking what file access
in `kanban/board.bv` (now `kanban/speculative/board.bv`) should look like. Builds on
`use-as-binding-2026-11-18.md` (binding, destructure, backticks as implicit `use`),
`capability-sigils-2026-05-06.md` and `capability-sigils-2026-05-16.md` (`&` and `*`
references), `callable-files-2026-04-14.md`, and the Object as the arguments-and-replies shape
(`xml-construction-named-only-2026-10-26.md`). Answers the empty `file-system` ticket.

## The idea

Brevity is built on an addressable file system, and data files should take part in it, not only
`.bv` files. A file answers like a call: **one positional value, its contents, plus named
entries.** A directory is a live, keyed collection of files.

```brevity
use Dir, File

type TicketFile = FrontMatter[status Text?, created Text?]

tickets *Map[Text, TicketFile] = Dir("./tickets/*.md")
lists *Map[Text, Lines] = Dir("../.kanban/lists/*")
columns Lines = File("./columns")
```

## `use Dir, File`

The program depends on the host's file system once, by name. For a root `.bv` file the runtime
environment defines what `Dir` and `File` mean and the limits of what they may reach. Each
directory or file is then an ordinary construction, not a `use` of its own.

**The grant is hoisted.** A construction with a literal path is hoisted into the manifest, as a
backtick address is an implicit `use`, so the manifest still lists everything the file may touch.
A path computed at runtime must fall under a grant that is declared statically; outside every
grant it is a compile error.

## The left side: shape and capability

The binding's annotation gives the shape of what it holds and the capability it asks for, with
the capability sigils references already use:

| Binding | Means |
|---|---|
| `x Map[Text, T] = Dir(…)` | a snapshot, read once |
| `x &Map[Text, T] = Dir(…)` | a live, read-only reference |
| `x *Map[Text, T] = Dir(…)` | a live, writable reference |

- **The fold-back is a reference write.** `tickets` isn't a local copy that syncs: it refers to
  the cell the `Dir` actor holds, and `<-` writes the cell it refers to, as a callee writes a `*`
  param it was granted. The sigil on a literal construction is hoisted as a read or read-write
  grant.
- **The type flows into the constructor.** The annotation is the call's expected type, so the
  compiler hands the element type, with its stored form, to the `Dir` it builds: the reverse of
  "a bind takes its callee's type" (`session-2026-11-06-bind-takes-callee-type.md`). The `Dir`
  moves bytes and applies the type's encode and decode; it never parses.
- **`Map`, not `List`.** A directory is keyed by name. Per-entry writes (`tickets[slug] <- …`) are
  the ordinary case; replacing the whole collection (`tickets <- …`) is a visibly different act,
  and bang enforcement carries it out: a function containing that `<-` must be named `!`, so the
  write shows at every call site. A `<-` through a `*` reference counts as a write for the `!`
  rule.
- **Open: a new cell or a reference.** `x *Integer = 0` declares a new cell, while
  `x *Map[…] = Dir(…)` binds a reference. The rule would be: a right side that yields a cell binds
  a reference to it, as passing a cell to a `*` param does; any other value initialises a new
  cell. That follows the param precedent, but the meaning depends on the right side.

## Live and static

A `Dir` is an actor, so it's live: `.keys` lists what's there now, and `sub` reports keys
arriving and leaving. The board needs that: `@create!` adds a ticket, another machine's
`git pull` adds and removes files, a list file appears the first time a column is saved. A static
list taken at load is just a value read from it (`names = tickets.keys`), so no second form is
needed.

## Entry types own their stored form

The element type says what each file is, and the type decides how it is stored. No format
appears where a type goes.

- **`Lines`** is a list of single-line texts, stored one per line. An item containing a line break
  can't be written; the write fails, never silently splitting.
- **`FrontMatter[fields]`** is a Markdown document: its body as the positional value, the named
  fields as named entries, stored as front-matter ahead of the body. `type TicketFile =
  FrontMatter[status Text?, created Text?]` names one; its field types are checked
  (`tickets[slug].status` is a `Text?`).
- **Any other type is stored in Brevity's native serialization,** so `*Map[Text, List[Text]]`
  round-trips any text, line breaks included.
- **An untyped file is `Text`;** `Blob` when bytes are wanted, stated.
- A document type is a value shape plus a decode and an encode, so a library can define new ones;
  the host deals only in bytes and Text. (Precedent: types that carry their serialization, as with
  Rust's serde or Haskell's `Show`/`Read`.)

## Named entries belong to the type; file-system metadata is `:file`

The entry type owns the named lane: a ticket's named entries are its front-matter fields.
File-system metadata is always under one reserved key, `:file`: an Object of `path`, `modified`,
`created`, `size`, `exists?`. It never collides with a type's keys (a ticket's `created` is
front-matter; `file.created` is the file system's).

## Using an entry

| Code | What the `Dir` does |
|---|---|
| `body, :status, :created = tickets[slug]` | reads `slug.md`, decodes it, returns the Object |
| `tickets[slug].status <- "review"` | sets that field and rewrites the file; the body is untouched |
| `tickets[slug] <- edited` (a Text) | replaces only the positional value, the body; the front-matter is untouched |
| `tickets[slug] <- ("# Title\n", :status, :created)` | a new key: creates `slug.md` |
| `tickets.keys` | lists the matching files' keys |
| `tickets.remove!(slug)` | deletes `slug.md` |
| `:file = tickets[slug]` | file-system metadata (`file.path`, `file.modified`) |
| `sub tickets, (change) { … }` | watches the directory |

**Writes touch only what they name.** Writing a plain value replaces the positional value and
leaves the named entries alone, so editing a ticket's body can't damage its front-matter. Writing
an Object sets the entries it gives.

Binding follows the existing destructure rules: positional names take positional values, `:name`
takes a key, and a positional destructure ignores named keys when the count matches (checked on
js; a mismatched count is the ticket
`a-positional-destructure-with-too-many-names-binds-null`).

## What `board.bv` loses

The `Files` service; the list-filter-read-parse loop in `Tickets.@load!`; the front-matter regex
helpers; `@restatus.`'s whole-file rewrite; the list-file read and join in `Column` and
`Board.@write.`; the `Editor`'s front-matter split and rejoin; and `Ticket.path`. The `Sync` actor
stays: git is a process, not a file.

## Open questions

- **Cell or reference** on the left (above).
- **Concurrency.** Two actors writing one file: does a host actor per file serialize them through
  its mailbox, as `Sync` serializes git?
- **Watch granularity.** What does `sub` on a directory deliver: the changed key, or the whole
  Object?
- **Metadata writes.** Is `:file` read-only, or can some entries be set?
- **Host-defined addresses.** The editor's scratch directory (`Dir("host/tmp/*")`) is a host
  address, not a real path; it needs a convention.
- **Where document types live.** `TicketFile` in the program, or beside the tickets
  (`tickets.bv`) so other tools share it?
- **Collection type names.** `Dir` (files, live) was chosen over `Store` (interface-neutral, so a
  browser key-value store could share it), `Glob`, `Files`, `Collection`.
