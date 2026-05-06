# Brevity Language Specification
## `catch` — Non-Local Exit and Block Control

*Draft — March 2026*

---

## 1. Overview

`catch` is Brevity's unified mechanism for non-local exit. It replaces the `break`, `continue`, `next`, `redo`, and `retry` keywords found in other languages with a single construct that is explicit, named, and value-carrying.

The design principle is simple: common iteration control is handled by ordinary conditional expressions. When control flow becomes complex enough to require non-local exit, that complexity should be visible and named.

## 2. Syntax

### 2.1 Basic Form

A catch block declares a labeled exit point. Code within the block can jump to that exit point at any depth of nesting.

```
catch #label {
  <body>
}
```

Invoking `#label` from anywhere within the body immediately exits the catch block. Execution continues after the closing brace. For void exits (no return value), the bare label is sufficient. To carry a value out, use `#label(expr)`.

### 2.2 With Value

A catch block is an expression. If the exit label is invoked with a value, that value becomes the result of the `catch` expression.

```
result = catch #found {
  over haystack (item) {
    if item::matches
      #found(item)
  }
  null  // fell through, not found
}
```

If the block completes without the label being invoked, the last expression in the block is the result, following standard Brevity evaluation rules.

### 2.3 Without Value

A bare label with no parentheses — `#label` — exits the block with no return value. The form `#label()` with empty parentheses is also accepted but the bare form is preferred.

```
catch #done {
  repeat {
    ...
    if finished #done
  }
}
```

Assigning the result of a void catch to a variable is a compiler error:

```
x = catch #done { #done }  // Error: #done carries no value
```

## 3. Type Safety

The compiler enforces type consistency across all exit paths through a catch block. Every invocation of the label and the block's fall-through expression must agree on type.

### 3.1 Consistent Types

```
x = catch #out {
  if bad #out(0)       // Integer
  if worse #out(-1)    // Integer
  42                   // Integer (fall-through)
}
// x : Integer
```

### 3.2 Type Mismatch (Compiler Error)

```
x = catch #out {
  if bad #out("nope")  // Text
  42                   // Integer — Error: mismatched types
}
```

### 3.3 Void vs. Value

A catch label is either void (invoked as bare `#label` or `#label()` with no argument) or value-carrying (invoked as `#label(expr)`). Mixing the two is a compiler error.

```
catch #mixed {
  if a #mixed         // void
  if b #mixed(42)     // value — Error: inconsistent label usage
}
```

## 4. Nested Catch and Multi-Level Exit

Catch blocks nest naturally. An inner block can invoke an outer label, enabling multi-level exit without special syntax.

```
catch #outer {
  over rows (row) {
    catch #next_row {
      over row::cells (cell) {
        if cell::poison
          #outer              // exit everything
        if cell::skip
          #next_row           // skip to next row
        process(cell)
      }
    }
  }
}
```

Each label is lexically scoped to its catch block. Referencing a label outside its enclosing catch is a compiler error.

## 5. Integration with Block Labels

The `#label` syntax used by catch is part of Brevity's universal block labeling system. The same `#label` prefix can annotate any block for use with `end#label` validated closing.

### 5.1 Loop Labeling

When a `#label` annotates a loop's trailing function, it can be used both as a catch exit point and as an `end#label` target.

```
#outer over items (item) {
  #inner over item::children (child) {
    if child == "skip"
      #outer                // break outer loop
    if child == "found"
      #outer(child)         // break outer with value
    process(child)
  }
}
```

> **Note:** The `#label` prefix can appear on the same line as the block it annotates, or on the preceding line. Both forms are equivalent.

### 5.2 Label Placement

Inline:

```
#setup if (config::ready) {
  server.start!
  db.connect!
}
end#setup
```

Preceding line:

```
#setup
if (config::ready) {
  server.start!
  db.connect!
}
end#setup
```

## 6. Relationship to Iteration

Brevity does not have `break` or `continue` keywords. The common case of conditional iteration is handled by ordinary `if`/`else` within a loop body.

### 6.1 Simple Conditional (No Catch Needed)

```
over items (item) {
  if !boring process(item)
}
```

```
over items (item) {
  if item::valid
    transform(item)
  else
    log_skip(item)
}
```

These patterns cover the majority of real iteration logic. No special control flow keywords are needed.

### 6.2 Early Exit from Loop (Catch)

When iteration requires early termination, `catch` provides explicit, named exit.

```
// Find first match
result = catch #found {
  over items (item) {
    if item::matches #found(item)
  }
  null
}
```

### 6.3 Skip Current Iteration (Catch)

For complex bodies where skipping an iteration is clearer than nesting in an `if`:

```
over items (item) {
  catch #next {
    validate(item)
    check_dependencies(item)
    if conflict #next
    process(item)
  }
}
```

> **Design note:** The ceremony of catch for skip-iteration is intentional. If your loop body is complex enough to need non-local exit, that complexity should be visible. Simple cases should use if/else.

## 7. Catch as Expression

`catch` is a full expression in Brevity. It can appear anywhere an expression is expected: assignment, function arguments, return values, pipelines.

```
// In assignment
value = catch #e { compute_or_bail(#e) }

// In function argument
print(catch #e {
  if valid result_string
  else #e("fallback")
})

// In return
-> catch #e {
  if ready data
  else #e(default_data)
}
```

## 8. Scoping Rules

- A label is lexically scoped to its enclosing catch block.
- A label cannot be invoked outside its enclosing catch. Attempting to do so is a compiler error.
- A bare label cannot be stored, passed as an argument, or returned from a function. It is not a first-class value. However, a label *reference* can be passed explicitly using the `&` operator (see Section 9).
- Label names must be unique within their immediately enclosing scope. Shadowing an outer label with the same name is a compiler error.

```
catch #a {
  catch #a {      // Error: #a shadows outer #a
    ...
  }
}
```

```
catch #a {
  catch #b {
    #a              // OK: reaches outer catch
    #b              // OK: reaches inner catch
  }
  #b               // Error: #b not in scope
}
```

## 9. Label References

A label can be passed to another function using the `&` (reference) operator at the call site. The receiving function declares the parameter with the `#` prefix, identifying it as a label reference. This allows a called function to invoke the catch exit on behalf of the caller.

### 9.1 Passing a Label Reference

At the call site, `&#label` creates a reference to the label. In the receiving function's parameter list, the `#` prefix declares a label parameter. Inside the callee, the label is invoked using the same `#name` syntax as a lexical catch label.

```
a : Array = [...]
ref i = 0
catch #done {
  repeat {
    stopper(a, i, &#done)
    i <- i + 1
  }
}

stopper = (a, i, #stop) {
  if (a.get(i) == null) #stop
}
```

The `#` prefix is symmetric: `&#done` at the call site passes the label, `#stop` in the parameter list receives it. Inside the callee, `#stop` reads identically to a lexical catch label — because from the callee's perspective, it behaves as one.

### 9.2 Value-Carrying References

Label references can carry values, just like direct label invocations.

```
result = catch #found {
  over items (item) {
    deep_search(item, &#found)
  }
  null
}

deep_search = (item, #on_match) {
  over item::children (child) {
    if child::matches
      #on_match(child)     // exits #found with child
  }
}
```

The same type consistency rules apply. If `#found` is value-carrying, invocations of `#on_match` in the callee must pass a value of the correct type.

### 9.3 Void References

For void labels, the callee invokes the reference with no arguments using the bare `#name` form, consistent with void catch labels elsewhere in the language.

```
catch #done {
  repeat {
    check(&#done)
  }
}

check = (#bail) {
  if too_many_retries
    #bail                   // invokes #done, exits catch
}
```

### 9.4 Lifetime and Safety

A label reference is bound to the lifetime of its enclosing `catch` block. The compiler enforces the following restrictions:

- A label reference may be passed to a synchronous function call. The catch block is guaranteed to be alive for the duration of the call.
- A label reference may ***not*** be stored in a `ref` binding, returned from a function, or passed to an asynchronous operation. These would allow the reference to outlive its catch block.
- Attempting to use a label reference after its catch block has exited is a compiler error where detectable, and a runtime panic otherwise.

```
// OK — synchronous, catch block alive during call
catch #done {
  helper(data, &#done)
}

// Error — label reference escapes catch lifetime
catch #done {
  ref saved = &#done         // Error: cannot store label reference
}

// Error — async may outlive catch block
catch #done {
  spawn later(&#done)         // Error: label reference escapes to async
}
```

> **Design note:** The `&` operator at the call site and the `#` prefix in the parameter list make label passing explicit and visible on both sides. A reader can immediately see that a catch exit capability is being shared. This is a deliberate contrast with implicit closure capture, which would allow labels to escape invisibly.

### 9.5 Wire Boundary

Label references cannot cross actor boundaries. Because `catch` is a local control flow mechanism with no CAM wire representation, a label reference is not serializable. Passing `&#label` to a public handler on another actor is a compiler error.

```
catch #done {
  other_actor.process!(&#done)  // Error: label reference is not wire-serializable
}
```

## 10. Wire Protocol Representation

`catch` is a purely local control flow mechanism. It has no representation in the CAM wire protocol. A catch exit is resolved within the actor's own execution and never generates a wire message.

This is by design. Non-local exit is a property of the computation, not of the communication between actors. An actor may use catch internally to manage its own control flow, but this is invisible to any actor sending it messages.

## 11. Compilation

The compiler transforms `catch` into the target platform's native non-local exit mechanism.

- **JavaScript:** Labeled blocks with `break` statements. Value-carrying catch compiles to a variable assignment before the break.
- **Rust:** Labeled loop/block with `break` expressions, which natively support values.
- **Erlang:** Case expressions with throw/catch or continuation-passing style, depending on nesting depth.

> **Implementation note:** The compiler should prefer the lightest-weight mechanism available on each target. JavaScript labeled break is preferable to try/catch for performance.

## 12. Grammar Summary

```
catch_expr     ::= "catch" label block
label          ::= "#" identifier
label_invoke   ::= label                  // void exit
               |   label "(" ")"          // void exit (alt)
               |   label "(" expr ")"     // value exit
label_ref      ::= "&" label              // pass label as argument
label_param    ::= label                  // receive label in param list

block_label    ::= label ( block | statement )
end_label      ::= "end" label
```

Where `label_invoke` may appear at any expression position within the lexical scope of the corresponding `catch` block. The bare form (no parentheses) is preferred for void exits; parentheses are required only when carrying a value.

## 13. Design Rationale

### 13.1 Why Not break/continue?

`break` is a blunt instrument. It exits the nearest loop, and multi-level break requires labels in every language that supports it (Rust's `'label: loop`, Java's `label: for`). `catch` subsumes all of these with a single, uniform construct: named, value-carrying, arbitrary-depth exit.

### 13.2 Ceremony Is Proportional to Complexity

Simple iteration uses `if`/`else` with no ceremony. `catch` only appears when control flow is genuinely complex. The syntactic weight of `catch` is a feature: it signals to the reader that something non-trivial is happening.

### 13.3 Two Constructs, Not Five

Brevity's iteration control consists of two mechanisms: `if` for the common case and `catch` for everything else. This replaces `break`, `continue`, `next`, `redo`, and `retry` with a smaller, more orthogonal set of primitives.

---

*End of Specification*
