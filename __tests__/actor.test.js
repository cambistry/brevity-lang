import { runActor } from './helpers.js';

describe('actors', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @refActor
        =
        ref user = User()
        :answer = user.hello()
        -> :answer : Text

      @inlineActor
        =
        :answer = User().hello()
        -> :answer : Text

      @multiActor
        =
        ref greeter = Greeter()
        ref echo = Echo()
        :answer = greeter.hello()
        text = echo.echo(answer)
        -> text : Text

      User
        =
        @hello
          =
          -> answer: "world" : Text
        -> self

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
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'refActor', from: 'c' },
        { id: '2', op: 'inlineActor', from: 'c' },
        { id: '3', op: 'multiActor', from: 'c' },
      ],
    });
  });

  it('actor declaration — instantiated with ref', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('actor declaration — instantiated inline', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('multiple actor definitions', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': ['Text'], re: ['world'], to: 'c' });
  });
});
