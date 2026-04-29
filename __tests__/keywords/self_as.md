# `self as`

LLM orientation: `self as` defines typed projections for an actor. It coexists
with public handlers.

## Canonical Form

```brevity
One
  <>
  =
  self as Integer = -> 1
  self as Text = -> "one"
  @ping = -> pong: "ok" as Text
  .
end#One
```

Use by assigning to a target type:

```brevity
n Integer = One()
t Text = One()
```

## CAM Message Form

File-level actors can respond to type projection messages:

```json
{ "op": ["Integer", "as"], "from": "c" }
```

The reply is positional with the projected value:

```json
{ "re": [42], "bv-a": ["Integer"] }
```

## Tested Behavior

- Multiple `self as` clauses can coexist.
- Target type selects the projection.
- Negated catch-all form `self as !Self = -> ...` is tested.
- Two-line clause syntax is tested.
- Public handlers still work alongside projections.
- Untyped actor refs such as `g = Greeter!()` still call handlers normally.

## LLM Rules

- Use `self as Type = -> value` for actor-to-value projection.
- Do not describe `self as` as just another public handler.
- Use `Name!()` when the actor value should stay messageable instead of being
  immediately projected to a scalar target type.
