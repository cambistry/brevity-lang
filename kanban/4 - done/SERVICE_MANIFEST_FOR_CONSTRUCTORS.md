source
======

@Document = <content: Text> {
  @title = -> get_title(content) : Text
  @body = -> content
  @index_of = |match Text| { ... } : Integer
}

{
  Document: <content: Text> -> {
    title: -> Text
    body: -> Text
    index_of: Text -> Integer
  }

  publish: (Document) -> .
}

Note removal of unnecessary parens in document.
