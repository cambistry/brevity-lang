import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// subscribe@<cell> — long-lived correlation. Initial `re` is the current value;
// every subsequent set@<cell> replays a new `re` to each registered subscriber
// using the stored id.
//
// Single combined script keeps the compiled artifact consistent across test
// suites (the Erlang target writes to a shared per-worker dir, so each unique
// source overwrites the prior compile).
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @val *Integer = 0
  @label *Text = "hi"
  @flag *Boolean = false
`;

describe('subscribe — initial value', () => {
  it('integer cell: first re carries current value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
    );
  });

  it('text cell: first re carries current text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@label', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['hi'], to: 'c' } },
    );
  });

  it('boolean cell: first re carries current flag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@flag', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Boolean'], re: [false], to: 'c' } },
    );
  });
});

describe('subscribe — replay on set', () => {
  it('set after subscribe replays new value with same id', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'subscribe@val', from: 'c' } },
      { output: { id: '9', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[7], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '9', 'bv-a': ['Integer'], re: [7], to: 'c' } },
    );
  });

  it('multiple sets each replay', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[10], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [10], to: 'c' } },
      { input: { op: [[20], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [20], to: 'c' } },
      { input: { op: [[30], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [30], to: 'c' } },
    );
  });

  it('text cell replays on set', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'subscribe@label', from: 'c' } },
      { output: { id: '5', 'bv-a': ['Text'], re: ['hi'], to: 'c' } },
      { input: { op: [['bye'], 'set@label'], 'bv-a': [['Text']], from: 'c' } },
      { output: { id: '5', 'bv-a': ['Text'], re: ['bye'], to: 'c' } },
    );
  });
});

describe('subscribe — multiple subscribers', () => {
  it('two subscribers each receive replays under their own ids', async () => {
    await expectBehavior(script,
      { input: { id: 'A', op: 'subscribe@val', from: 'a' } },
      { output: { id: 'A', 'bv-a': ['Integer'], re: [0], to: 'a' } },
      { input: { id: 'B', op: 'subscribe@val', from: 'b' } },
      { output: { id: 'B', 'bv-a': ['Integer'], re: [0], to: 'b' } },
      { input: { op: [[42], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: 'A', 'bv-a': ['Integer'], re: [42], to: 'a' } },
      { output: { id: 'B', 'bv-a': ['Integer'], re: [42], to: 'b' } },
    );
  });
});

describe('subscribe — independence from get', () => {
  it('subscribe does not interfere with normal get/set', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subscribe@val', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [0], to: 'c' } },
      { input: { op: [[5], 'set@val'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [5], to: 'c' } },
      { input: { id: '2', op: '@val', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [5], to: 'c' } },
    );
  });
});
