---
status: done
created: 2026-11-21
---
# Construction order: a path to a cell before its line is a compile error

  Design: notes/opre-extend-and-as-2026-11-20.md ("Instance layers": construction order);

  notes/super-2026-11-19.md; notes/forward-reads-in-constructor-blocks-2026-11-11.md.

‌

- Code that runs during construction can reach the child through late-bound names: a

    parent's constructor body run at the subclass's \`super\` line, or a class block's

    initializer calling an inherited function. A construction-time path that can reach a

    cell before its line is a compile error, followed through calls and overrides, the

    parent's body included:

‌

      T = *{

        got Integer = probe()

        probe = -> 0

      }

      U = T ^ (k Integer) *{

        super()

        marker Integer = k      // below super

        probe = -> marker       // T's body calls it at the super line: error

      }

‌

- The same for \`super[A]\` / \`super[B]\` at different lines, and for a parent's body

    reaching another parent's names through the child.

- First, write the case above and record what each target does today (null, crash,

    hang, or a compile error already). Keep those tests.

- Tests on every target: the case above; the same with the cell above \`super\` (fine);

    through a chain of calls; through a second parent; a class block whose initializer

    calls an inherited function that reaches a later cell.

- Docs: LANGUAGE_OVERVIEW.md (subclass constructors).
