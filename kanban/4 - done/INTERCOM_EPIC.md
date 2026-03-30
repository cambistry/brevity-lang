Big piece: external calls.

Example:

```
use Remote

@call_remote(:url : Text)
  :response = Remote.get(:url)
  reply :response
```

Remote, as declared in the `use` statement, is reachable, in this case, at the literal path "Remote".

The call `Remote.get(:url)` is a call to the `get` op at the address `Remote`. For instance:

```
{
  "id": "123", // unique for the call
  "to": "Remote", // literal path
  "op": [
    { "url": "http://example.com"},
    "get"
  ]
}
```

Sample response:

```
{
  "id": "123",
  "re": { "body": "CONTENT" }
}
```
In this example the remote op might look something like:

```
@get(:url : Text)
  ...
  reply :response : Text
```

Note that in the example at the top, there is no formal declaration of the type of the "url" parameter of `get`, or the return type of the op.

Those types can both be obtained by making a compile-time request to the Remote actor. The purpose of the `use` statement is to flag the dependency to the compiler, so that a request for the service profile can be made in order to do type checking and inference.

In the example, the return type of call_remote is inferred from the "Remote" service profile.

"Remote" (wherever that might actually be) generates a service manifest when compiled. (See service_manifest.test.js.) The manifest for the above example might be:

```
{
  get: (url: Text) -> (response: Text)
}
```

---

I am a little puzzled about how to set up the test harness for this feature: the consuming actor/file does not *itself* make the service profile request, that is a compiler operation. I had been thinking we would just stub out the async back post and incoming response, but that doesn't feel quite right. I think we should actually instantiate two actors for each test -- in fact get two actors to communicate with each other.

The tricky bit is the construction of the parent that will connect these two actors.

A test would do the following:

Each actor involved has a path address, such as "Remote" (above).

1) parse the primary actor (the one with the `use` statement)
2) scan it for `use` statements
3) compile and generate service manifests for each actor referenced in the `use` statements
3b) (If necessary, repeat recursively for any `use` statements in those actors)
4) compile the primary actor, using the service manifest(s) to infer types or enforce type conflicts
5) Instantiate the actor
6) Fire the initiating message
7) Route posted messages between the actors involved, according to their "to" path.
8) Process and verify the primary response
