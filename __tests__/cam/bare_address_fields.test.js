import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `to`, `from` and `ty` are never bracketed
//
// An address field holds a bare address (`svc.bv:x`), and `ty` bare tags. The
// `#<…>` that marks an address belongs only in a payload. A received message
// with a bracketed `to`, `from` or `ty` is malformed: the receiver answers it
// with an `ex` (when it has an `id`) and never routes it.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @get = -> 1
  @take = (n Integer) -> n
`;

describe('bracketed address fields are rejected', () => {
  it('a bracketed `to`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'get', to: '#<:get>', from: 'c' } },
      { output: { id: '1', ex: { get: 'bad_address' }, to: 'c' } },
    );
  });

  it('a bracketed `from`, answered at the bare address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'get', from: '#<c>' } },
      { output: { id: '1', ex: { get: 'bad_address' }, to: 'c' } },
    );
  });

  it('a bracketed `ty` tag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'take'], ty: [['#<Integer>']], from: 'c' } },
      { output: { id: '1', ex: { take: 'bad_address' }, to: 'c' } },
    );
  });

  it('with no `id`, nothing is answered, and the next message is handled', async () => {
    await expectBehavior(script,
      { input: { op: 'get', to: '#<:get>', from: 'c' } },
      { input: { id: '2', op: 'get', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });
});
