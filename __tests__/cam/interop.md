# Remote Interop

Remote interop in Brevity is not a special subsystem bolted onto an otherwise
local language. It is one of the main things the language is designed to make
pleasant.

The tests in this area show the same basic pattern in increasingly involved
forms:

- one actor sends a request to another
- the remote actor replies
- the original actor continues and returns its own reply

## Request-reply as normal programming

In many systems, remote work requires dropping into RPC clients, callback
handlers, or explicit transport plumbing. Brevity tries to keep the remote case
close to ordinary actor code:

```brevity
uses Remote as {
  get: (url: Text) -> (response: Text)
}

@call_remote
  =
  url: Text
  =
  response: Text = Remote.get(:url)
  -> :response as Text
```

This reads almost like a local call, but the boundary is still explicit:

- `Remote` is declared
- the method interface is known
- the interaction is still message-based

That combination is one of the language's main ambitions.

## Silent cross-actor calls

Interop is not only about request-reply. Some remote calls are intentionally
effect-only:

```brevity
uses Store as {
  notify: (msg: Text) -> .
}

spawn Store.notify(:msg)
```

This matters because actor systems often include both:

- value-returning conversations
- one-way notifications

Brevity wants both to feel like first-class parts of the same model.

## Chained actors

The multi-actor tests are important because they show that a handler can be a
link in a chain rather than merely an endpoint.

One actor can:

- receive a request
- call another actor
- transform the result
- reply onward

That pattern is common in real systems, and it is one of the places where
Brevity's message vocabulary becomes more than syntax.

## Callbacks are just more actor traffic

The callback cases are especially revealing.

An actor can be waiting on a worker while the worker itself calls back into the
original actor for more information. Brevity still treats this as one coherent
message-oriented world rather than as an exceptional "reentrant" situation.

That matters because it suggests the language is comfortable with conversational
structure, not only linear request-response flows.

## Why this matters for the language

The value of these interop cases is not that they prove messages can be sent.
Any system can do that. The value is that Brevity tries to make those
conversations look like normal source code while keeping their boundaries
visible.

That is part of the broader promise of the language:

- remote collaboration should be explicit
- type shape should survive the boundary
- code that spans actors should still feel readable
