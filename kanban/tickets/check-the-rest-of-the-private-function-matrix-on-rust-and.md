---
status: inbox
created: 2026-11-16
---
# Check the rest of the private-function matrix on rust and erlang

  Private functions from inner scopes: confirm on rust and erlang

‌

  On js all of these call an outer \`#f\` correctly: file handler; class method; class

  constructor block; class in class (the file's \`#f\`, and the outer class's \`#f\`); a class

  block's nested \`new\`; a lambda in a class method; \`#f(6)\` with args from a class; a writing

  \`#f!()\` called from a class.

‌

  Add each as a wire test in \_\_tests\_\_/functions/private.test.js (or class_scope.test.js for

  the class-block case), run it on rust and erlang, and fix what fails. Never skip a target.
