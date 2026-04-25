import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subtype consumption — runtime behavior across targets
//
// Compile-time discipline is covered by subtype_consumption.test.js. This file
// asserts that the runtime dispatch actually produces the right value on every
// target, so any future parity drift between js / erlang / rust is caught.
// Synthetic domain-neutral types.
// ═══════════════════════════════════════════════════════════════════════════════

describe('subtype runtime — inherited method on subtype value', () => {
  const script = `
    T = <x Integer> {
      @a = -> result: x as Integer
    }
    U = <T | y Integer> {
      @b = -> result: y as Integer
    }

    @callInherited
      =
      u = U(11, 13)
      :result Integer = u.a()
      -> :result as Integer

    @callOwn
      =
      u = U(11, 13)
      :result Integer = u.b()
      -> :result as Integer
  `;

  it('inherited method returns the supertype-declared value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@callInherited', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('own method returns the subtype-declared value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@callOwn', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });
});

// Static narrowing (`u T = U(...)`) is exercised at compile time in
// subtype_consumption.test.js (the validator rejects subtype-only method
// calls on a supertype-narrowed value). The runtime currently rejects the
// narrowed assignment itself with an unrelated error, so that combination
// is not asserted here.

describe('subtype runtime — override fires on the subtype instance', () => {
  // U overrides @a. A direct call on a U instance runs U's implementation,
  // even though @a is also defined on the supertype.
  const script = `
    T = <> {
      @a = -> result: 1
    }
    U = <T |> {
      @a = -> result: 2
    }

    @superCall
      =
      t = T()
      :result Integer = t.a()
      -> :result as Integer

    @subCall
      =
      u = U()
      :result Integer = u.a()
      -> :result as Integer
  `;

  it('supertype instance runs supertype @a', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@superCall', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subtype instance runs subtype override of @a', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@subCall', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});
