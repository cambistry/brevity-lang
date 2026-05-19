# Marshal / Lifecycle

LLM orientation: this directory tests CAM lifecycle messages for actor state.
Use it when describing capture, hydrate, snapshots, and clone behavior.

## Capture

Capture is a CAM lifecycle message:

```json
{ "id": "1", "cam": "capture", "from": "parent" }
```

The actor replies to `from` with a snapshot in `re`:

```json
{ "id": "1", "re": { "count": 42 }, "to": "parent" }
```

Tested captured cells include:

- `*Integer`
- `*Text`
- `*Boolean`
- `*Decimal`
- `*Float`
- zero, empty text, and false values
- `*Function` cells, represented as generated lambda labels

Capture reflects current state after mutation.

## Hydrate

Hydrate restores state through CAM:

```json
{ "id": "2", "cam": [{ "count": 5 }, "hydrate"], "from": "parent" }
```

The actor acknowledges:

```json
{ "id": "2", "re": "hydrate", "to": "parent" }
```

Hydration overwrites initialization defaults. Later mutations apply on top of
hydrated state.

## Round Trip

Tests cover capture from one actor, hydrate into a new actor, and continued
execution from the captured state.

Clone behavior is independent after hydrate:

- clone A can mutate beyond the snapshot
- clone B can remain at the snapshot

Function cells also round-trip: a captured `*Function` label restores the
current call behavior in the hydrated actor.

## LLM Rules

- Describe capture/hydrate as CAM lifecycle traffic.
- Use `cam: "capture"` and `cam: [snapshot, "hydrate"]` in wire examples.
- Show hydrate ack as `re: "hydrate"`.
- Treat snapshots as actor state, not as source code.
