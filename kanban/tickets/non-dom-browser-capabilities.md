---
status: inbox
created: 2026-04-18
---
# non-DOM browser capabilities

Is there any essential functionality that needs to be preserved in a non-browser context, such as a swift application, that does not make sense under the DOM namespace?

⏺ Good question. A few capabilities that are essential to most apps but don't belong in DOM:

- Timers (setTimeout, setInterval) — scheduling is universal. A Swift app needs timers too. Not a document tree concern.
- HTTP/networking — fetching data is fundamental everywhere. In Swift it's URLSession, in browser it's fetch, but the need is the same.
- Persistent storage — every app stores state. Browser has localStorage; Swift has UserDefaults, Core Data, etc.
- Clipboard — exists across all GUI platforms.
- Navigation/routing — browser has URL-based routing, but "go to a different view" is universal.
  This suggests there might be a platform-agnostic layer underneath. Browser is one implementation of these capabilities, but a Swift host would provide the same abstract services through its own actors — Swift.fetch or Native.storage or whatever the naming ends up being.
  Or maybe these are just capability interfaces that different platform actors happen to satisfy. You don't need a shared namespace — you need a shared shape. A constructor that needs "something that can fetch" doesn't care if the provider is Browser or a Swift networking actor, as long as it speaks the same message protocol.
  That's back to your platform-awareness sketch — it's really about capability shapes, not namespace hierarchy.

My gut instinct for v1 is to support NONE of these capabilities. All of these should happen in Brevity (or other) controller code. The missing needed affordance is event capture.

⏺ That's a clean cut. The DOM service actor handles rendering and event capture — it's a view layer. Timers, networking, storage, routing all live in controller actors written in Brevity (or whatever language). The DOM doesn't do those things; it tells you what happened and you tell it what to show.

  Event capture is the key piece that makes this work — without it, the DOM is write-only and you need to escape to JS for any interactivity. With it, the loop closes: controller sends rendering messages to DOM, DOM sends events back to controller.

  That's a very small, principled browser surface for v1.
