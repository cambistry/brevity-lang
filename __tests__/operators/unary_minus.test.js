import { expectBehavior } from '../helpers.js';

// Unary minus on numbers. It binds tighter than `*` and looser than `^`
// (`-2 ^ 2` is `-(2 ^ 2)`); on a literal it folds to a negative literal.
describe('unary minus', () => {
  const script = `
    @literal = () -> -1
    @negate = (k Integer) { return -k }
    @group = (a Integer, b Integer) { return -(a + b) }
    @operand = (a Integer, b Integer) { return a * -b }
    @power = () -> -2 ^ 2
    @float = (f Float) { return -f }
    @default = (k Integer = -1 + 3) { return k }
    @list = () -> [-1, 2]
    @subtract = (a Integer) { return a -1 }
  `;

  it('a literal, a name, a group', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'literal', from: 'c' } },
      { output: { id: '1', re: [-1], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[5], 'negate'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [-5], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: [[2, 3], 'group'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', re: [-5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('an operand of *, and below ^', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2, 3], 'operand'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', re: [-6], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'power', from: 'c' } },
      { output: { id: '2', re: [-4], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a Float', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1.5], 'float'], ty: [['Float']], from: 'c' } },
      { output: { id: '1', re: [-1.5], ty: ['Float'], to: 'c' } },
    );
  });

  it('in a default, and in a list', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'default', from: 'c' } },
      { output: { id: '1', re: [2], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'list', from: 'c' } },
      { output: { id: '2', re: [[-1, 2]], ty: ['List[Integer]'], to: 'c' } },
    );
  });

  it('after an operand, `-` subtracts', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'subtract'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [4], ty: ['Integer'], to: 'c' } },
    );
  });
});
