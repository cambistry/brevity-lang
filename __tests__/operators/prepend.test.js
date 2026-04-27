import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// >> prepend operator — mutates a stateful list ref by adding the LHS value to
// the head. Right-associative; the chain `a >> b >> *list` is equivalent to
// concatenating [a, b] onto the front of *list (final: [a, b, ...orig]).
// Statement-level only: validate.js rejects `>>` used as a sub-expression.
// ═══════════════════════════════════════════════════════════════════════════════

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('>> single-value prepend', () => {
  const script = `
      @one
        =
        ns List of Integers! = [2, 3]
        1 >> ns
        -> result: ns

      @ontoEmpty
        =
        ns List of Integers! = []
        42 >> ns
        -> result: ns
  `;
  it('prepends to a non-empty list', async () => {
    await expectBehavior(script, inp('1', '@one'), out('1', 'List of Integers', [1, 2, 3]));
  });
  it('prepends to an empty list', async () => {
    await expectBehavior(script, inp('2', '@ontoEmpty'), out('2', 'List of Integers', [42]));
  });
});

describe('>> chained prepends', () => {
  const script = `
      @two
        =
        ns List of Integers! = [3, 4]
        1 >> 2 >> ns
        -> result: ns

      @three
        =
        ns List of Integers! = [4]
        1 >> 2 >> 3 >> ns
        -> result: ns
  `;
  it('two-value chain — final order matches source order', async () => {
    await expectBehavior(script, inp('1', '@two'), out('1', 'List of Integers', [1, 2, 3, 4]));
  });
  it('three-value chain', async () => {
    await expectBehavior(script, inp('2', '@three'), out('2', 'List of Integers', [1, 2, 3, 4]));
  });
});
