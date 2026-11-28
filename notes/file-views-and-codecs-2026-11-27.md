# File views and codecs — 2026-11-27

Proposal from discussion; not implemented. Revises parts of `files-as-addressed-values-2026-11-25.md`
(listed under "What this supersedes"), and builds on `type-namespaces-2026-11-25.md`,
`constructor-return-as-retired-2026-11-23.md` (`self as` is the one projection form; an actor may
declare several, one per target type), `session-2026-11-01-as-renders-or-fails.md` and
`dom-as-actor-subsystem-2026-04-13.md` (addresses routed through a subsystem actor).

The aim is to avoid hidden mechanisms. A file is an actor that holds bytes. Reading those bytes
as something richer (lines, Markdown with front matter) is done by a type the program names. The
file never guesses a format.

## The problem

```brevity
f *Text = File("/path")
```

This reads well: `f` is used like a Text cell. But the program often wants the file as lines, or
as Markdown with front matter: still live, still writable, still the same file underneath.

Rejected spellings:

- **`lines *List[Text] = File(…)`, or `File(…) as *List[Text]`.** This assumes the File knows how
  to become a `List[Text]`, and that splitting on line feeds is the only way to segment a text.
  The responsibility is in the wrong place.
- **`lines = Lines(File(…))`, or `lines *Lines <|> File(…)`.** A wrapping function on the right
  applies to the whole right side, so `lines *Lines, :created_at = File(…)` can't be written.
- **`lines *Lines = File(…)`, the annotation naming the view.** `x *T = e` already declares a new
  cell initialised from `e` (`cards *List[Text] = []`). The same spelling would mean a copy or a
  live view depending on what the right side is. Nothing says that writing `lines` reaches the
  file, or that changes to the file reach `lines`.

## Decision so far

### The file is parameterized by what it holds

`File` and `Dir` take the type of their contents as a parameter:

```brevity
tickets = Dir[TicketFile]("../tickets/*.md")
lists   = Dir[Lines]("../../.kanban/lists/*")
```

- **The name binds a typed address** (below): the Dir's address and the type `TicketFile`.
  `tickets` is not a local cell holding a Map, so there is no copy to confuse with a view.
- **The parameter types the positional projection only.** A File's named lane is its file-system
  metadata (`:created_at`, `:modified`, `:path`), untouched by the parameter. So a destructure
  works: the parameter isn't a wrapper around the whole right side.
- **A destructure is a read.** It takes the projection, so every name binds a value:

  ```brevity
  lines, :created_at = File[Lines]("./columns")   // values: a snapshot
  columns = File[Lines]("./columns")              // live
  columns[3] <- "x"
  :created_at = columns                           // a read of its metadata
  ```

  The same expression bound whole is live, and destructured is a read. No sigil tells them apart;
  the form does.
- **A typed bind is a read too:** `specs List[Text] = File[Lines]("../columns")`.
- **File and Dir know only their storage:** bytes, and Text over bytes. The parameter must be a
  type that wraps what they store (below), so `File[List[Text]]` is a compile error and the line
  split happens only because `Lines` was named.
- **Defaults:** plain `File` is `File[Text]`, plain `Dir` is `Dir[Text]`.

`tickets Dir[TicketFile] = "../tickets/*.md"`, the annotation constructing from its initializer,
would be sugar for the binding above. It is a ticket of its own:
`kanban/tickets/an-annotation-constructs-its-type-from-the-initializer.md`.

### A view type wraps what is stored

A view type is an ordinary one-field type over the stored form. This exists today:
`type Markdown(Text)` compiles, `Markdown(t)` constructs one, and `(t) = md` destructures it.

- **It is nominal.** A `Markdown` passed where a `Text` is expected is a compile error, as it is
  today. A document is not casually its text.
- **Reading it from storage converts nothing.** The constructor wraps the stored Text and
  destructuring unwraps it, so the whole-value round trip is exact by construction.
- **Its positional value is the stored form.** `(doc) = md` is the raw document, front matter
  included. A positional field is reached only by destructuring, so an accessor receives it as a
  parameter.
- **`type` is the right keyword.** A `Lines` or a `Markdown` is a value that exists without any
  file: it can be built, passed, compared and stored. What is live belongs to the File and Dir
  actors. The type contributes only pure structure.

### A view type presents itself with `self as` and `self set`

The type's body declares presentations, as an actor declares projections: `self as T`, one per
target type, each optionally paired with a `self set` that takes a `T`. Accessors take the
positional value as their first parameter; a `set` returns the new positional value.

```brevity
type Lines(Text) {
  self as List[Text] = (text) -> split(text)
  self set = (lines List[Text]) {
    over(lines) (line) { if (contains(line, "\n")) { throw … } }
    join(lines, "\n")
  }
}

type Markdown[M](Text) {
  self as Text = (doc) -> …the body…
  self set = (doc, body Text) -> …doc with the body replaced…
  FrontMatter as M = (doc) -> …parse the --- block…
  FrontMatter set = (doc, fm M) -> …doc with the block rewritten…
}
```

- **Reads dispatch on the target type.** `body Text = md` is the body; `lines List[Text]` is the
  split.
- **Writes dispatch on the value's type.** `md <- "## x"` goes to the Text `set`. Lines' `set`
  replaces the whole value, so it takes no current value; Markdown's take `doc` so each keeps the
  other part.
- **A presentation may be named,** `FrontMatter as M`, and is then reached with `::`:
  `md::FrontMatter`. Naming is optional. It is needed when two presentations share a type, or
  where a name reads better than a type. A nominal type (`type Body(Text)`, `self as Body`) is the
  other way to tell two apart.
- **Element focuses are derived.** A List- or Map-shaped presentation gives `lines[3]`,
  `md::FrontMatter.status` and their writes for free: get the collection, change one element,
  `set` it back. An explicit indexer is only for when the derived one is too slow or too coarse.
- **`<!` is derived** on a Map-shaped presentation: `set(merge(get, new))`.
- **Iteration goes through a presentation.** `over(lines)` is `over` of `lines` as
  `List[Text]`, the same way an actor's projection is taken.

**Each declaration adds one capability.** Nothing beyond what's declared is promised:

| Declared | Gives |
|---|---|
| `type Lines(Text)` alone | the stored text as a `Lines`, read and written whole |
| `self as List[Text]` | read as a list; elements readable |
| its `self set` | written as a list; elements writable |

### The lens laws replace exact round trips

Each `self as` / `self set` pair is a lens and must obey two laws: reading what you set gives it
back, and setting what you read changes nothing. A `set` that can't keep them fails, and the write
fails with it.

`lines[3] <- "a\nb"` would come back as two lines, so Lines' `set` throws. Because the stored
text is never split and rejoined on a plain read or whole write, those can't fail. No `Line`
type with "no line feed" as a refinement is needed: the check belongs to the `set`.

### Conversions are only for a change of storage

`as S` and `from S` in a type's namespace remain for a real change of representation. Text over
Blob (UTF-8) is the one in this design, declared on Text. A view type that only re-reads the
same stored form declares presentations, never conversions.

### What runs where

`File` and `Dir` are host actors. `TicketFile` and `Lines` are pure functions compiled into this
program, and the host can't run them. So the view is not in the Dir: it is on the program's side,
in what the compiler emits.

**At run time there are only host actors:**

- **The file-system actor**, under the root, routes each message to the representative actor for
  its path.
- **A File representative** per path holds the bytes and answers: `read`, replying
  `(text, version)`; `write(text, if: version)`, replying `ok` or `conflict`; `sub`, pushing
  `(text, version)` on every change, through it or on disk; and metadata reads.
- **A Dir representative** per path answers `keys`, `add`, `remove!` and `sub` on the listing. An
  entry's address is its file's path.

**`Dir[TicketFile]("../tickets/*.md")` evaluates to a typed address,** a plain value: the Dir's
address, the key focus from the glob, and the static type `TicketFile`. No message is sent at the
binding. It is live because the address is; it is bidirectional because the compiler knows
`TicketFile` and lowers every use through its functions. The type must be known statically.

**What each use lowers to:**

| Source | Lowers to |
|---|---|
| `tickets.keys` | `Dir.keys`, each key with `.md` stripped |
| `tickets[slug]` | a typed address for `…/slug.md`; still no message |
| `body Text = tickets[slug]` | `read` → `t`; TicketFile's `self as Text` on `t` |
| `sub tickets[slug], (b Text) { … }` | `File.sub`; each pushed `t` through `self as Text` |
| `lists[c.slug] <- c.paths` | Lines' `self set` on `c.paths` → `t`; `write(t)`, unconditional |
| `tickets[slug]::FrontMatter <! :status` | loop: `read` → `(t, v)`; `t2` = `FrontMatter set(t, merge(FrontMatter as(t), (:status)))`; `write(t2, if: v)`; on `conflict`, again |

### Writes check a version

A write that needs the current value (a `set` that takes `doc`, a derived element write, `<!`) is
read, compute, then write on condition that the version hasn't moved. A write that replaces the
whole value needs no read and is unconditional. The lens laws make the retry correct: a `set` is
a pure function of the current text and the new part.

A transform run inside the File actor would not work, for two reasons:

- **The File can't run it.** The transform is this program's code, and the File is a host actor;
  across targets (js, erlang, rust) code can't be shipped to it.
- **The mailbox doesn't see every writer.** An editor, `git rebase` and the board app on another
  machine write the disk directly. A mailbox serializes Brevity writers only.

The version check covers both: it fails if anything changed the file since the read, through the
mailbox or not. A content hash is the version (an mtime is too coarse). The File stays simple and
knows only bytes. A local cell (`*Integer`) is the same protocol with a trivial version.

### One File per path

Two `Dir`s or `File`s on one path, in one compilation or several, reach the same representative.
This is addressing, not interning, as in the DOM subsystem: the path is the file's address, and
the file-system actor routes every message for it, spawning the representative when the first
message for a path arrives. No program coordinates. This is what makes `sub` reach every reader.

### `<-` replaces; `<!` merges

- **`<-` replaces what it addresses,** dispatched on the value's type. `md <- "## Content"`
  replaces the body (Markdown's Text `set`), and `md::FrontMatter <- (status: "done")` leaves
  `status` as the only field.
- **`<!` merges.** `md::FrontMatter <! status: "done"` sets `status` and keeps the rest.
- **`md::FrontMatter.status <- "done"`** already covers a single field. `<!` is for setting
  several fields in one write.

### Collections: one model, two storages

A file viewed as `Lines` and a directory viewed as a `Dir` have the same shape: a collection whose
every element is a focus. An element can be read, written, watched and removed:

```brevity
lines[3] <- "x"           // rewrites the Text; watchers of the file see it
lines.remove!(3)          // as tickets.remove!(slug) deletes a file
sub lines[3], (l) { … }   // reacts to that line
```

**The storage shows only underneath:**

- **Writing one element is atomic in both.** Writing the whole collection isn't always:
  `lines <- xs` is one write to one File, so it is atomic, while `tickets <- m` touches many files
  and is not.
- **Versions are per File.** Two line writes conflict with each other; two entry writes don't.
- **A Dir is a cell of cells.** Each entry is its own File, and `keys`, adding and `remove!` go to
  the Dir itself.

**The line between live and pure** is the same in both: cells are host actors (File, Dir and each
entry), and view types are pure structure the compiler applies on the program's side.

### A glob is a key focus

`Dir("./tickets/*.md")` combines an address and a view of the keys: it narrows the keys to those
matching `*.md` and strips the suffix, so `slug.md` reads as `slug`. Writing `tickets["x"]`
creates `x.md`, and a key that can't fit the pattern is a failed write, by the same laws as any
focus. The glob stays in the path because it is the familiar spelling.

## The board, applied

The file parts of `kanban/speculative/board.bv`:

```brevity
type TicketMeta(status: Text?, created: Text?)
type TicketFile Markdown[TicketMeta]

tickets = Dir[TicketFile]("../tickets/*.md")
lists   = Dir[Lines]("../../.kanban/lists/*")

ticketFrom = (slug Text)
  doc = tickets[slug]
  body Text = doc                          // the body
  :status, :created = doc::FrontMatter     // the front matter
  heading = body |> after("# ") |> before("\n") |> trim
  Ticket(:slug, title: either(heading, slug), status: status ?? "inbox", created: created ?? "")
end#ticketFrom

-- Tickets --
@restatus. = (t Ticket, status Text) { tickets[t.slug]::FrontMatter <! :status }
@create! = (title Text, status Text) : Text {
  slug = slugOf(title)
  created = Process.today
  tickets[slug] <- "# #{title}\n"
  tickets[slug]::FrontMatter <- (:status, :created)
  …
}

-- Column --
@read! = {
  paths List[Text] = lists[slug] ?? []
  listed <- List.unique(map(paths) (path) { path |> after(LISTED_PREFIX) |> before(".md") })
}

-- Board --
specs List[Text] = File[Lines]("../columns")
@write. = { over(columns) (c) { lists[c.slug] <- c.paths } }

-- Editor --
scratch = Dir("host/tmp/*")
@run! = {
  body Text = tickets[slug]
  name = "kanban-#{slug}.md"
  scratch[name] <- body
  :path = scratch[name]
  Terminal.hand!(command: "#{editor} \"#{path}\"")
  edited Text = scratch[name]
  scratch.remove!(name)
  if (edited != body) { tickets[slug] <- edited }   // the Text set: the body only
}
```

- **The Editor's original comment becomes literally true:** a plain value written to the ticket
  replaces only its body, so the front matter never reaches the editor.
- **`::FrontMatter` keeps front matter off the metadata lane.** The original
  `body, :status, :created = ticketFiles[slug]` mixed the two.

## What this supersedes in `files-as-addressed-values-2026-11-25.md`

- **"The type flows into the constructor."** Kept in a narrower form: `File[C]` and `Dir[C]` take
  the content type as a parameter, but File and Dir still know only bytes and Text. The type does
  the reading, on the program's side.
- **`:file` as the metadata key.** Metadata is the File's own named lane. The collision it avoided
  doesn't exist: front matter is a presentation of a view type, never a property of the File.
- **`FrontMatter[fields]` as an entry type.** It becomes `Markdown[M]`, a view type whose front
  matter is the named presentation `::FrontMatter`.
- **`<-` of an Object setting only the entries it gives.** `<-` replaces; `<!` merges.
- **The sigil table (`x T`, `x &T`, `x *T` over a File).** The name binds a typed address, so the
  read-only mode needs another spelling (open below).
- **Concurrency through the File's mailbox.** Writes check a version instead; the mailbox can't
  run the program's code and doesn't see writers outside Brevity.
- **"Any other type is stored in Brevity's native serialization."** Open again: a
  native-serialization fallback would be a conversion, and whether a type gets it without naming
  it is the implicit behaviour this note avoids.

## What is new and needs design

- **Type parameters on actors:** `File[C]`, `Dir[C]`, and the constraint that `C` wraps the
  actor's storage.
- **A typed address** as the value of `Dir[C](…)`, and the compiler lowering uses through `C`.
- **`self as` / `self set` in a type's body,** and named presentations (`FrontMatter as M`).
- **`x::Name` for a named presentation.** Today `::` reaches a protected member (`base::h`) or
  qualifies a namespace (`HTML::div`). A presentation is a third meaning. The capital letter tells
  it apart from a member, but it is an overload.
- **The File protocol:** `read` with a version, `write(text, if: version)`, `sub`.
- **The `<!` operator.**

## Open questions

- **Creating a ticket takes two writes:** the body, then the front matter. A watcher can see the
  file in between. An atomic create needs one write that sets several presentations, perhaps
  `tickets[slug] <- ("# #{title}\n", FrontMatter: (:status, :created))`, a third shape for `<-`.
- **Retries.** How many before a versioned write gives up, and the failure reply the caller then
  handles.
- **`type TicketFile Markdown[TicketMeta]`.** It names an instantiation of a generic view type and
  composes well, but it isn't the one-field form. Is it an alias, or a nominal type that keeps
  Markdown's presentations? And `Markdown[M](Text)` is invented syntax for a generic one-field
  type.
- **A projection at a parameter.** Whether a `Lines` passed to `map(…)` is taken as its
  `List[Text]` presentation, as at a typed bind.
- **`lists[slug] ?? []`.** It relies on a missing key reading as null, and `[]` going through the
  List presentation: a typed bind of a union.
- **Is a Dir a view type too?** A directory node with a keyed presentation, each element a File.
  That would make "a cell of cells" a presentation whose elements are addresses.
- **Positional focuses move.** If another writer deletes line 1, `lines[3]` now refers to a
  different line. Does a `sub lines[3]` follow the line or stay on index 3? A keyed focus is
  stable; an indexed one is not.
- **A read-only view.** How a program takes a File it may read but not write.
- **Key focuses beyond globs.** Whether a key view can be declared apart from the path, for keys a
  glob can't express.
- **`<!` beside `!` names.** `!` marks writing functions (`add!`), and `x <!y` reads close to one.
  Legible with spaces; worth a second look.
- **The 11-25 note's other open questions** stand: watch granularity on a `Dir`, whether
  metadata can be written, host-defined addresses, and where document types live.
