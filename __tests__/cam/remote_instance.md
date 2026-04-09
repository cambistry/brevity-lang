# Remote Instances

Some remote collaborators are not single fixed actors. They are factories for
instance-like resources that must first be created and then addressed through
their own returned handles.

The tests in this area cover that pattern.

## The shape

```brevity
<
  "WebView": (WebView) { open: () -> . }
>

view = *WebView(path: "/my_view")

@open = { view.open() . }
```

This declares a remote instance reference rather than a plain static
collaborator. The actor first requests a new instance, then routes later calls
to the returned address.

## Why this matters

Many real systems involve resources like:

- views
- windows
- sessions
- subprocess handles
- dynamically created service instances

Those are not naturally modeled as one fixed named actor. They are better
understood as created instances with their own address and lifecycle.

## Construction first, then routing

The tests show that instance creation emits a `::new` message and expects a
reply whose `from` field identifies the created instance.

After that, ordinary method calls like:

```brevity
view.open()
view.getTitle()
view.close()
```

are routed to the returned instance address.

That means the remote instance feature is really about preserving a coherent
actor surface over a two-step protocol:

1. ask for an instance
2. talk to the instance

## Why this is not just an implementation detail

It would be possible to hide all of this in a runtime library and expose only a
special-case client object model. Brevity does something more interesting: it
keeps the actor structure visible.

That means:

- construction is still a message
- the instance is still addressed by messages
- event handling and method calls still fit the same general model

The feature therefore says something important about the language: it wants even
dynamic resource lifecycles to remain legible in actor terms.
