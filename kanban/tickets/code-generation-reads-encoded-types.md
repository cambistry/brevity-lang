---
status: in-progress
created: 2026-11-22
---
# Code generation reads encoded types

    The JavaScript, Rust and Erlang generators read encoded types and derive \`ty\` tags                                                                                      

    from them. Remove the type-string fields from the AST and the helpers that parse                                                                                        

    type strings.                                                                                                                                                           

‌

- No wire message changes: every existing wire test passes unedited.                                                                                                    

‌

    Done when: nothing in src/ parses a type string outside the parser, and the full                                                                                        

    suite is green.
