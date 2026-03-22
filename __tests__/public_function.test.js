import { createActor, expectActorReply } from './helpers.js';

describe('public function', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @helloOpen
        =
        -> answer: "world" as Text

      @helloInline = -> answer: "world" as Text

      @echo = |:text : Text| ->(:text : Text)

      @add
        =
        :a : Integer
        :b : Integer
        =
        x : Integer = a + b
        -> :x
    `);
  });

  it('@hello — open style', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', op: '@helloOpen', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' },
    });
  });

  it('@hello = -> — dense inline', async () => {
    await expectActorReply({
      actor,
      receive: { id: '2', op: '@helloInline', from: 'c' },
      reply: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' },
    });
  });

  it('@echo — named param round-trip', async () => {
    await expectActorReply({
      actor,
      receive: { id: '3', op: [{ text: 'abc' }, '@echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
      reply: { id: '3', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' },
    });
  });

  it('whitespace-only blank line between params and body', async () => {
    await expectActorReply({
      actor,
      receive: { id: '4', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'c' },
    });
  });
});
