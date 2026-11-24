---
status: done
created: 2026-11-03
---
# A class declared inside a class closes over the classes that enclose it, up to the file

  **Problem:** A class closes over its file actor (notes/session-2026-11-03-class-reads-file-cells.md). A class declared inside another class also closes over the file,

  skipping the class it's declared in.

‌

  brevity

  total *Integer = 1

‌

  Outer = (n Integer) *{

    count *Integer = n

‌

    Inner = *{

      \@get = { return count + total }   // count is Outer's, total is the file's

    }

‌

    \@make = { i = Inner(); x Integer = i.get(); return x }

  }

‌

  **Decision: a chain of enclosing actors.** A class closes over its directly enclosing class, that class's enclosing class, and so on up to the file. The file is the

  outermost class in the chain. Classes elsewhere in the file that aren't in this chain are invisible, including siblings, a sibling's nested classes, and classes

  nested inside this one.

‌

  **Behaviour:**

- **A name resolves to its innermost declaration.** First the class itself, then each enclosing class outward, then the file. Function params keep their exception. The

    no-shadowing rules apply at each level, as they do between a file and its classes today.

- **The chain is made of actors, not class declarations.** Inner, constructed by the Outer actor o1, reads o1's count, wherever or whenever its code runs, even while

    another Outer actor o2 is running. Two Outer actors' Inners read different counts, as Svc.W() and s.W() do one level up.

- **Each read is a message to the actor that owns the name,** as reads of file cells are today. An enclosing actor answers while it waits, as the file actor does.

- **Writes and function calls follow the same chain,** once the writes-and-calls ticket lands.

- **Resolution happens at compile time.** A name that no level of the chain declares is a compile error. Today it compiles, then fails.

‌

  **Implementation notes:**

- **Front end:** markOuterReads in src/outer_reads.js records which level owns each name, not just outer: true.

- **Handles:** each actor holds a handle to the actor that constructed it lexically. A read names how many levels up it's going. The actor can either forward it up the

    chain or keep handles to every level. Forwarding needs a serve clause at each level. Holding every level means passing the whole chain at construction. 

- **JS:** #outer becomes a chain, or forwards.

- **Rust:** outer_states[0] assumes the file's state is at the bottom of the dispatch stack, and that doesn't hold for an enclosing class. Each instance has to record

    which instance encloses it, and a read finds that instance's state in its pool, or on the stack if it's mid-dispatch.

- **Erlang:** every enclosing class process, not just the file actor, needs the serve clause in its waits.

- **First, check whether nested class declarations compile and run today on each target.** If they don't, that work comes first.

‌

  **Done when:** the same behaviour on JS, Rust and Erlang, with tests covering:

- an inner class reading its enclosing class's cell, the file's cell, and a cell two classes up

- the innermost name winning when two levels declare the same one

- two actors of the enclosing class giving their inner classes different values

- a name from a class outside the chain, such as a sibling, being a compile error
