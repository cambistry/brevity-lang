import { expectReply, runActor } from './helpers.js';

describe('actors', () => {
  it('actor declaration — instantiated with ref', async () => {
    const source = `
      @test
        =
        ref user = User()
        :answer = user.hello()
        -> :answer : Text

      User
        =
        @hello
          =
          -> answer: "world" : Text
        -> self
    `;
    await expectReply({
      source,
      receive: { id: '12345', op: 'test', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('actor declaration — instantiated inline', async () => {
    const source = `
      @test
        =
        :answer = User().hello()
        -> :answer : Text

      User
        =
        @hello
          =
          -> answer: "world" : Text
        -> self
    `;
    await expectReply({
      source,
      receive: { id: '12345', op: 'test', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('multiple actor definitions', async () => {
    await expectReply({
      source: `
        Greeter
          =
          @hello = -> answer: "world" : Text
          -> self
        end#Greeter

        Echo
          =
          @echo = |text : Text| ->(text : Text)
          -> self
        end#Echo

        @test
          =
          ref greeter = Greeter()
          ref echo = Echo()
          :answer = greeter.hello()
          text = echo.echo(answer)
          -> text : Text
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': ['Text'],
        re: ['world'],
        to: 'caller',
      },
    });
  });
});
