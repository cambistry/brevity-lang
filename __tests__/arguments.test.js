import { createActor, expectActorReply } from './helpers.js';

describe('arguments', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @multInline
        =
        a : Integer
        b : Integer
        =
        x : Integer = a * b
        ->(x : Integer)

      @multOpen
        =
        a : Integer
        b : Integer
        =
        x : Integer = a * b
        ->
          x : Integer

      @keyMapped
        =
        outer: inner : Text
        =
        ->(result: inner : Text)

      @mixed
        =
        a : Integer
        b : Integer
        :message : Text
        =
        result : Integer = a + b
        ->
          result : Integer
          comment: message : Text
    `);
  });

  it('positional args — explicit inline', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', op: [[3, 5], '@multInline'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [15], to: 'c' },
    });
  });

  it('positional args — open form', async () => {
    await expectActorReply({
      actor,
      receive: { id: '2', op: [[3, 5], '@multOpen'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      reply: { id: '2', 'bv-a': ['Integer'], re: [15], to: 'c' },
    });
  });

  it('key-mapped arg — outer: inner : Text', async () => {
    await expectActorReply({
      actor,
      receive: { id: '3', op: [{ outer: 'hello' }, '@keyMapped'], 'bv-a': [{ outer: 'Text' }], from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('mixed positional + named args', async () => {
    await expectActorReply({
      actor,
      receive: { id: '4', op: [[1, 2, { message: 'add this' }], '@mixed'], 'bv-a': [['Integer', 'Integer', { message: 'Text' }]], from: 'c' },
      reply: { id: '4', 'bv-a': ['Integer', { comment: 'Text' }], re: [3, { comment: 'add this' }], to: 'c' },
    });
  });
});
