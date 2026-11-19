import { expectBehavior } from '../helpers.js';

describe('assignment', () => {
  let script = `
    @typedAssign
      =
      result Integer = if true {
        x Integer = 42
      } else {
        0
      }
      return :result

    @untypedAssign
      =
      result Integer = if true {
        x Integer
        x = 42 as Integer
      } else {
        0
      }
      return :result

    @plainLocal
      =
      x = 40
      result Integer = x + 2
      return :result
    `;

  it('plain local var used in expression before reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'plainLocal', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } },
    );
  });

  it('typed assign as last block statement evaluates to assigned value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'typedAssign', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } },
    );
  });

  it('untyped assign as last block statement evaluates to assigned value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'untypedAssign', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } },
    );
  });
});
