import { expectBehavior } from '../helpers.js';

// A lambda as a value is its address, relative to its actor (`#<:@N>`), tagged with
// its signature; one in a `*Function` cell is tagged `Function`. A call through the
// value reaches the lambda. Its `@N` is numbered by each target, so the replies
// match its form.

describe('a lambda as a value', () => {
  const script = `
    transform *Function = (x Integer) -> x * 3
    @cell = () -> transform
    @lam = { g = (k Integer) -> k + 1; return &g }
    @apply = (n Integer) { r Integer = transform(n); return r }
    @local = (n Integer) { g = (k Integer) -> k + 1; r Integer = g(n); return r }
  `;

  it('a lambda in a *Function cell is its address, tagged Function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'cell', from: 't' } },
      { output: { id: '1', re: [expect.stringMatching(/^#<:@\d+>$/)], ty: ['Function'], to: 't' } },
    );
  });

  it('a local lambda replied is its address, tagged with its signature', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'lam', from: 't' } },
      { output: { id: '2', re: [expect.stringMatching(/^#<:@\d+>$/)], ty: [['%f', { args: ['Integer'], re: ['Integer'], writes: false }]], to: 't' } },
    );
  });

  it("a call through a cell's lambda reaches it", async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[2], 'apply'], ty: [['Integer']], from: 't' } },
      { output: { id: '3', ty: ['Integer'], re: [6], to: 't' } },
    );
  });

  it('a call through a local lambda reaches it', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[2], 'local'], ty: [['Integer']], from: 't' } },
      { output: { id: '4', ty: ['Integer'], re: [3], to: 't' } },
    );
  });
});
