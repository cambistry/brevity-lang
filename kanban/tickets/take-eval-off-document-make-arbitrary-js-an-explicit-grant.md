---
status: inbox
created: 2026-11-10
---
# Take eval off document; make arbitrary JS an explicit grant

  **Problem.** The DI header is meant to state exactly what a file can touch: HTML: (:main, :p) grants two tags and nothing more. But :document silently grants all

  of JavaScript, because documentManifest includes eval (Text) -> (Text), which runs at global scope. From there a file can reach the network, storage, window

  and everything else. One escape hatch in a common grant makes the header's precision meaningless.

‌

  **How** **it** **surfaced.** The examples viewer (docs/site/viewer.bv) has no fetch, so it reads source files through a synchronous XHR passed to document.eval. The

  workaround works, and it shouldn't have been that easy.

‌

  **Proposed.**

- Remove eval from documentManifest, in src/codegen/browser/runtime.js (both places it's declared).

- If arbitrary JS stays available, make it its own grant with a name that sounds as dangerous as it is (for example JS: (:eval)), so a file that can run

    anything says so in its header.

- Replace the viewer's use with a fetch service granted in the header, ideally scoped (for example Fetch: ("hello/") rather than unrestricted fetch). This can

    be a separate ticket; until it exists, the viewer moves to the new explicit grant.

‌

  **Tests.** \_\_tests\_\_/browser/document_eval.browser.test.js covers document.eval today. Move those tests to the new grant rather than deleting them, and add a test

  that document.eval is rejected under :document alone.

‌

  **Out** **of** **scope.** Designing the fetch service itself.
