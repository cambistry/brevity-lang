import { compileActor, expectActorReply } from './helpers.js';

describe('assignment', () => {
  let script = `
    @typedAssign
      =
      result : Integer = if true {
        x : Integer = 42
      } else {
        0 as Integer
      }
      -> :result

    @untypedAssign
      =
      result : Integer = if true {
        x : Integer
        x = 42 as Integer
      } else {
        0 as Integer
      }
      -> :result
    `;

  it.todo('plain local var used in expression before reply');

  it('typed assign as last block statement evaluates to assigned value', async () => {
    await expectActorReply({
      script,
      receive: { id: '1', op: '@typedAssign', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('untyped assign as last block statement evaluates to assigned value', async () => {
    await expectActorReply({
      script,
      receive: { id: '1', op: '@untypedAssign', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });
});
