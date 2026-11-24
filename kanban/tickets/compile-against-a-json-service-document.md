---
status: done
created: 2026-11-22
---
# Compile against a JSON service document

  \`remotes: [{ path, service }]\` accepts the JSON document from ticket 2. Everything

  that reads another service's doc reads the JSON: validation, the effects check,

  override tables, remote parent classes and their instance layers, the diamond check.

‌

- A call to an op with no \`writes\` claim is treated as today's \`~>\`: allowed in a

    function not named with a bang, and that function then makes no claim itself.

- A parent class in another service is found through \`extends\`, as an address.

- The doc text is still accepted.

‌

  Done when: the remote tests (extend\_remote, layers\_remote, layers\_remote\_block,

  local\_and\_remote, extension_doc) each have a JSON-document variant that passes on

  all targets with the same wire expectations as the text one.
