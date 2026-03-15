import { expectReply, runActor } from './helpers.js';

describe.skip('actors', () => {
  it('actor declaration — named class, named export', async () => {
    const source = `actor User\n\non hello\n\n  reply answer: "world" : Text\n\nend#User\n`;
    await expectReply({
      source,
      exportName: 'User',
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('multiple actor definitions — named exports', async () => {
    const greeterSource = `
      actor Greeter

      on hello

        reply answer: "world" : Text

      end#Greeter
    `;
    const echoSource = `
      actor Echo

      on echo(:text : Text) reply(:text : Text)

      end#Echo
    `;

    await expectReply({
      source: greeterSource,
      exportName: 'Greeter',
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });

    await expectReply({
      source: echoSource,
      exportName: 'Echo',
      receive: { id: '2', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'caller' },
      reply: {
        id: '2',
        'bv-a': { text: 'Text' },
        re: { text: 'abc' },
        to: 'caller',
      },
    });
  });
});
