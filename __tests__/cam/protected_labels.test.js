import { expectBehavior } from '../helpers.js';

// On the wire, a protected (bare) label takes a leading `.`: cell `val` is
// `.val`, function `helper` is op `.helper`. Only the actor itself sends to
// one. See notes/protected-names-dot-prefix-2026-11-11.md.

describe('a protected cell is set by #set to .name', () => {
  const script = `
    val *Integer = 0
    label *Text = ""
    @pub *Integer = 0

    @read = -> val
    @readLabel = -> label
  `;

  it('from inside', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [[5], '#set'], to: '.val' }, from: 't' } },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('each cell by its own label', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [['hi'], '#set'], to: '.label' }, from: 't' } },
      { input: { id: '2', op: '@readLabel', from: 'c' } },
      { output: { id: '2', re: ['hi'], ty: ['Text'], to: 'c' } },
      { input: { id: '3', op: '@read', from: 'c' } },
      { output: { id: '3', re: [0], ty: ['Integer'], to: 'c' } },
    );
  });

  it('not from outside', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], '#set'], ty: [['Integer']], to: '.val', from: 'c' } },
      { output: { id: '1', ex: { 'set.val': 'unhandled' }, to: 'c' } },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a bare name is not its label', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: [[5], '#set'], to: 'val' }, from: 't' } },
      { output: { id: '1', ex: { set: 'unhandled' }, to: 't' } },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c' } },
    );
  });
});

// A function value is its label, so calling one is a send of `.double`.
describe('a protected function value is its .label', () => {
  const script = `
    double = (n Integer) -> n * 2

    @twice = (n: Integer) -> {
      f = &double
      r Integer = f(n)
      return r
    }
  `;

  it('called through the value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 4 }, '@twice'], ty: [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });
});
