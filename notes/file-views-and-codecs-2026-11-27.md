# File views and codecs — 2026-11-27

Proposal from discussion; not implemented. Revises parts of `files-as-addressed-values-2026-11-25.md`
(listed under "What this supersedes"), and builds on `type-namespaces-2026-11-25.md`,
`binderless-type-declaration-2026-10-25.md`, `constructor-return-as-retired-2026-11-23.md`
(`self as` is the one projection) and `session-2026-11-01-as-renders-or-fails.md`.

The aim is to avoid hidden mechanisms. A file is an actor that holds bytes. Anything that reads
those bytes as something richer (lines, Markdown with front matter) is a codec, named in the
program. The file never guesses a format.

## The problem

```brevity
f *Text = File("/path")
```

This reads well: `f` is used like a Text cell. Reading it takes the current contents, and
`f <- "text"` rewrites the file. But the program actually wants the file as a list of lines:
something that behaves as a `List[Text]` cell while the cell underneath is `*Text`, converted by
an encode and a decode. That is a bidirectional data view around `File(path)`.

Two spellings were rejected:

- **`lines *List[Text] = File(…)`, or `File(…) as *List[Text]`.** This assumes the File knows how
  to become a `List[Text]`, and that splitting on line feeds is the only way to segment a text.
  The responsibility is in the wrong place.
- **`lines = Lines(File(…))`, or `lines *Lines <|> File(…)`.** These put the codec on the right
  side. A destructure has one right side and several names, so anything on the right applies to
  the whole value. `lines *Lines, :created_at = File(…)` can't be written.

## Decision so far

### The file projects only its stored forms

`File` is an actor holding the file's bytes. It projects as a cell, `*Blob` and `*Text` (UTF-8),
and knows nothing else about its contents. Its named lane is file-system metadata:

```brevity
text *Text, :created_at, :modified = File("/path")
```

The 11-25 note kept metadata under one reserved key, `:file`, so it couldn't collide with
front-matter fields. That collision doesn't exist: front matter is not a property of a file. It
is produced by a codec, so its fields live in the decoded value, never in the File's named lane.

### A codec is a type that declares conversions both ways

`x as T` already converts a value or fails. A type's namespace block (`type-namespaces`) can
declare both directions against one stored type:

```brevity
type Lines List[Text] {
  as Text = (ls Lines) -> Text.join(ls, "\n")
  from Text = (t Text) -> Text.split(t, "\n")
}
```

- **Both types are named in declarations.** An earlier draft used functions named `decode` and
  `encode`. That made the codec a naming convention, and the stored type appeared only inside a
  parameter. `as Text` and `from Text` state it.
- **A codec over `S` is a type that declares both `as S` and `from S`.** A type with only `as S`
  is merely convertible to `S`.
- **The plain conversions are usable anywhere:** `ls as Text`, `t as Lines`.
- **The functions are pure,** as everything in a type namespace is. A codec keeps no state.

### The annotation names the codec, and `=` binds the view

```brevity
lines *Lines, :created_at = File("/path")
```

**Rule:** in a binding `x *C = e` where `e` projects as `*S`, if `C` declares both `as S` and
`from S`, then `x` is a view of that cell:

- reading `x` is `from S` applied to the current value,
- `x <- v` writes `v as S` to the underlying cell,
- `sub` on `x` gets the underlying cell's changes, converted with `from S`.

If `C` has no codec over `S`, the binding is a compile error. So `*List[Text] = File(…)` fails,
and the line split happens only because `Lines` was named.

**Why the annotation:** in a destructure, each name's annotation is the only place that can say
something about that name alone. The responsibility sits where it should: File knows bytes and
Text, and `Lines` knows Text and lines. A reader can look up `Lines` and see exactly what happens.

The sigil picks the mode, as in the 11-25 table:

| Binding | Means |
|---|---|
| `x Lines = File(…)` | converted once: a snapshot |
| `x &Lines = File(…)` | a live, read-only view |
| `x *Lines = File(…)` | a live, read-write view |

This settles the 11-25 note's open "cell or reference" question in one direction. A right side
that projects as a cell binds a reference to it. A codec annotation binds a view of that cell.

### Text is the same mechanism

Text over Blob is also a codec (UTF-8), so `f *Text = File(…)` is the general rule, not a
special case. Codecs stack: Blob → Text → Lines.

### Collections: one model, two storages

`File` and `Lines` have the same relationship as `Dir` and its files. In both, a container is
viewed as a collection, and both are live and bidirectional:

| Stored | Viewed as | Conversion |
|---|---|---|
| a Text | `Lines`, a list of texts | split and join on line feeds |
| a directory node | `Map[Text, *Blob]`, keyed by file name | the host's listing |

**Every element of a collection view is a cell.** A line is a focus on the list, as an entry is a
focus on the map. It can be read, written, watched and removed:

```brevity
lines[3] <- "x"           // rewrites the Text; watchers of the file see it
lines.remove!(3)          // as tickets.remove!(slug) deletes a file
sub lines[3], (l) { … }   // reacts to that line
```

Text is the List's storage layer, as the directory is the Map's. The surface model is the same:
a collection of cells, whatever stores it.

**The storage shows only underneath:**

- **Writing one element is atomic in both.** Writing the whole collection isn't always:
  `lines <- xs` is one transform on one File, so it is atomic, while `tickets <- m` touches many
  files and is not.
- **Writes are ordered across elements only when they share a cell.** Two line writes go through
  one File's mailbox, in order. Two entry writes go through two File actors, with no order
  between them.
- **A Dir is a cell of cells.** Its value is `Map[Text, *Blob]`: each entry is its own File
  actor, and `keys`, adding and `remove!` go to the Dir actor itself.

**The line between live and pure** is the same in both: cells are host actors (File, Dir and each
entry), and views are pure codecs stacked on cells.

### Lifting: a codec reaches into collections

If `C` is a codec over `S`, then `Map[K, C]` is a codec over `Map[K, S]` and `List[C]` is a codec
over `List[S]`, applied element by element. No form knows about files, and a `Dir` holds no
element type:

```brevity
lines   *Lines                  = File("./columns")   // one cell, seen as a list
tickets *Map[Text, TicketFile] = Dir("./tickets")    // a cell of cells, each seen as a TicketFile
lists   *Map[Text, Lines]      = Dir("../.kanban/lists")
```

The one thing a reader needs: the annotation is the shape wanted, the right side is the cell
that stores it, and lifting carries a codec into a collection's elements.

### A glob is a key codec

`Dir("./tickets/*.md")` combines an address and a view of the keys: it narrows the keys to those
matching `*.md` and strips the suffix, so `slug.md` reads as `slug`. That key view is
bidirectional. Writing `tickets["x"]` creates `x.md`, and a key that can't fit the pattern is a
failed write, by the same exact round-trip rule as any codec. The glob stays in the path because
it is the familiar spelling, but it follows the codec rules.

### Writes through a view are one transform

`lines[3] <- "x"` converts the text to lines, edits them, and converts them back. If the view
read the cell and then wrote it, a concurrent write could be lost in between. The write goes to
the underlying cell's actor as a single transform, conceptually
`under.update((t) -> (edit(t as Lines)) as Text)`, so that actor's mailbox serializes it. This
answers the 11-25 note's concurrency question for a single file: the File actor serializes all
writers, whichever views they go through.

### Front matter is a codec with named parts

```brevity
md *Markdown, :created_at = File("/path")

md::FrontMatter.status
md::FrontMatter <! status: "done"
md <- "## Content"
```

- **`Markdown` is a codec over Text.** Its decoded value has a positional part, the body, and a
  named part, `FrontMatter`.
- **`md <- "## Content"` replaces only the body;** the front matter is untouched.
- **`md::FrontMatter` is a view of a view,** one codec layered on another. Reading `.status`
  decodes it, and a write re-encodes only that block. Reads go down through both conversions,
  writes go up through both, and the File actor receives a single transform.
- **The parts are declared by the type,** so `::` reads only a part `Markdown` declares, never an
  arbitrary name.
- **Typed fields come from the annotation:** `md *Markdown[status: Text?, created: Text?]`, or a
  named type, `type TicketFile Markdown[status: Text?, created: Text?]`. Without a schema the
  front matter is an untyped `Map[Text, Text]`.

### `<-` replaces; `<!` merges

The 11-25 note gave `<-` two behaviours: a plain value replaced the positional part, and an Object
set only the entries it named. With `<!` those become two operators:

- **`<-` always replaces.** `md::FrontMatter <- status: "done"` leaves `status` as the only field.
- **`<!` merges.** `md::FrontMatter <! status: "done"` sets `status` and keeps the rest.
- **`md::FrontMatter.status <- "done"`** already covers a single field. `<!` is for setting
  several fields in one atomic write.

### `type Name Shape` is a newtype, never a codec

`type Lines List[Text]` means a new nominal type whose values are represented as
`List[Text]`. A block after it is the type's namespace. The head never implies a codec. The block
makes the type a codec only if it declares the two conversions.

It is nominal, not a transparent alias:

- **The namespace needs its own owner.** With an alias, `Lines`'s functions would belong to
  `List[Text]`: every list of texts would know how to become one text, which is the presumptuous
  conversion this design avoids.
- **The view rule needs a distinct type.** With an alias, `*List[Text] = File(…)` would build the
  same line-split view.
- **The invariant needs a home.** "No item contains a line feed" is true of `Lines`, not of every
  `List[Text]`.

How the newtype behaves:

- **Reading is free.** A `Lines` is accepted wherever a `List[Text]` is expected, so
  `List.map(lines, …)` works.
- **Making one is explicit.** `Lines(xs)` turns a `List[Text]` into a `Lines` and checks the
  invariant there. A plain list never becomes `Lines` implicitly.
- **A bare newtype is not a codec.** `lines *Lines = File(…)` is a compile error until `Lines`
  declares both `as Text` and `from Text`.

A transparent alias isn't needed for any of this. If one is wanted later, it needs its own
spelling, not `type Name Shape` with meaning that depends on whether a block follows.

## Exact round-trips

A view must be exact: converting a value to the stored form and back gives the same value, and a
write is never silently changed. `List[Text]` is too wide for `Lines`: `["a\nb"]` is joined and
split into `["a", "b"]`. There are two ways out:

- **`as Text` fails** on an item that contains a line feed. The write fails; nothing is split.
- **The element type excludes it:** `type Lines List[Line]`, where a `Line` is a Text with no line
  feed, so `as Text` can't fail.

The second is the better design, but Brevity has no refinement types, so `Line` can't be
declared yet. Until then, `type Lines List[Text]` with an `as Text` that fails is the honest form.

## What this supersedes in `files-as-addressed-values-2026-11-25.md`

- **"The type flows into the constructor."** `Dir` and `File` no longer receive the element type.
  They move bytes; the binding's codec does the conversion.
- **`:file` as the metadata key.** Metadata is the File's own named lane.
- **`FrontMatter[fields]` as an entry type.** It becomes `Markdown[fields]`, a codec whose front
  matter is the named part `::FrontMatter`.
- **`<-` of an Object setting only the entries it gives.** `<-` replaces; `<!` merges.
- **"Any other type is stored in Brevity's native serialization."** Open again: under this design
  a native-serialization fallback is itself a codec, and whether a type gets it without naming it
  is the implicit behaviour this note avoids.

## What is new and needs design

- **`self as *Text`, projecting a cell.** Today `self as` projects a value. The simplest spelling
  names one of the actor's own cells: `self as *Text = contents`. File then watches `contents`
  and writes it to disk.
- **`as S` and `from S` in a type namespace.** They are new entries: functions keyed by a
  conversion target or source rather than by a name.
- **`x::Part` on a view.** Today `::` reaches a protected member (`base::h`) or qualifies a
  namespace (`HTML::div`). Reading a declared part of a view is a third meaning. The capital
  letter tells it apart from a member, but it is an overload.
- **The `<!` operator.**

## Open questions

- **Positional focuses move.** A Dir entry is keyed by a stable name; a line is addressed by
  position. If another writer deletes line 1, `lines[3]` now refers to a different line. Does a
  `sub lines[3]`, or a held reference to it, follow the line or stay on index 3? Stability is a
  property of the key, not the storage: a `Map` view's focuses are stable, a `List` view's are
  not.
- **Glob keys beside other key codecs.** Whether a key view should also be writable in the
  annotation, apart from the path, for keys that a glob can't express.
- **Chaining codecs.** Does `*Lines` bound to something that projects only `*Blob` chain
  Blob → Text → Lines, or must the stored type match exactly? Leaning exact at first, with File
  projecting both `*Blob` and `*Text`.
- **`<!` beside `!` names.** `!` marks writing functions (`add!`), and `x <!y` reads close to one.
  Legible with spaces; worth a second look.
- **How a codec declares named parts.** For example `type Markdown (Text, FrontMatter: …)` plus the
  conversions, and how a generic schema parameter (`Markdown[fields]`) reaches the part's type.
- **Refinement types** for `Line`, so that `Lines` round-trips by construction.
- **Generic codecs.** How a parameterized type's conversions name its parameter (also open in
  `type-namespaces-2026-11-25.md`).
- **The 11-25 note's other open questions** stand: watch granularity on a `Dir`, whether
  metadata can be written, host-defined addresses, and where document types live.
- **Field syntax.** Type fields are written `name: Type` today; `type P (x Integer)` doesn't
  parse. The type-namespaces note's `(slug Text, …)` uses the other form. This note uses
  `name: Type`.
