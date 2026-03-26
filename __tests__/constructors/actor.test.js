import { expectReply } from '../helpers.js';

describe('actors', () => {
  const script = `
    @refActor
      =
      user = User()
      :answer = user.hello()
      -> :answer : Text

    @inlineActor
      =
      :answer = User().hello()
      -> :answer : Text

    @multiActor
      =
      greeter = Greeter()
      echo = Echo()
      :answer = greeter.hello()
      text = echo.echo(answer)
      -> text : Text

    User
      <>
      =
      @hello = -> answer: "world" as Text
      .

    Greeter
      <>
      =
      @hello = -> answer: "world" as Text
      .

    Echo
      <>
      =
      @echo = |text : Text| ->(text : Text)
      .
  `;

  it('actor declaration — instantiated with ref', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@refActor', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' },
    });
  });

  it('actor declaration — instantiated inline', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@inlineActor', from: 'c' },
      reply: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' },
    });
  });

  it('multiple actor definitions', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@multiActor', from: 'c' },
      reply: { id: '3', 'bv-a': ['Text'], re: ['world'], to: 'c' },
    });
  });
});
