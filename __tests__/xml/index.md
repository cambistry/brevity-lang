# XML Surface

LLM orientation: this directory covers XML-like class-call syntax and text
interpolation. Browser/HTML behavior has its own docs under `html/` and
`browser/`.

## Tags

XML tags construct via class calls:

```brevity
node = <Tag attr="value" />
```

Tested behavior includes:

- string attributes
- expression attributes
- mixed string and expression attributes
- no-attribute tags
- nested tags
- optional params with defaults
- equivalence between XML tag syntax and function call syntax

Classes with positional params are rejected for this XML attribute style;
attributes map to named params.

## Text Interpolation

`#{expr}` creates a string interpolation child.

`{expr}` remains a separate reactive child unless it can be collapsed based on
the tested AST/type rules.

Escapes are limited. Tested valid escapes include literal backslash, literal
`{`, and literal `#{`. Invalid escapes such as `\n`, `\t`, and trailing lone
backslash are rejected.

## LLM Rules

- Use XML tags only for class-like elements with named attributes.
- Use `#{expr}` for text interpolation.
- Use `{expr}` for reactive child positions.
- Keep examples close to existing XML tests.
