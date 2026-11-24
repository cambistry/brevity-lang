---
status: done
created: 2026-10-29
---
# Params document still emits the retired *( … ) header shape

extract() returns interface.params, a document describing the file's header: its file params and dependencies. buildParamsDocument (index.js) still renders it in the old header form:

*(

:"thing.bv" #

:Shapes (:Box, :Circle)

count: Integer

```
)
```

Source no longer accepts that form. File headers are now ( … ) *{ … } or lineal * … *. parseParamsDocument (src/validate.js) reads the old shape back: it requires a leading *( and parses only scalar entries.

Each dependency entry is already written in the :path sigil shorthand, which is option (a) for the deferred header-colon question ("path": (Alias) / HTML: (:div) → :HTML (:div)). The two should be decided together, so the params document and real headers end up in the same notation.

**Scope**

- Pick the params-document shape to match the header decision, for example a bare ( entries ).
- Update buildParamsDocument and parseParamsDocument, and the tests that assert interface.params, starting with __tests__/services/extract.test.js and __tests__/compile/output.test.js.
- Depends on the header-colon decision; see notes/session-2026-10-29-service-doc-notation.md, "Deferred: the header colon".
