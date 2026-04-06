import { expectBehavior, compileSource } from '../helpers.js';

describe('actors', () => {
  const script = `
    @refActor
      =
      user = User()
      :answer = user.hello()
      -> :answer as Text

    @inlineActor
      =
      :answer = User().hello()
      -> :answer as Text

    @multiActor
      =
      greeter = Greeter()
      echo = Echo()
      :answer = greeter.hello()
      text = echo.echo(answer)
      -> text as Text

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
      @echo = |text Text| ->(text as Text)
      .
  `;

  it('actor declaration — instantiated with ref', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@refActor', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('actor declaration — instantiated inline', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@inlineActor', from: 'c' } },
      { output: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('multiple actor definitions', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@multiActor', from: 'c' } },
      { output: { id: '3', 'bv-a': ['Text'], re: ['world'], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Actor with optional constructor params
// ═══════════════════════════════════════════════════════════════════════════════

describe('actors — optional constructor args', () => {
  const script = `
    @testWithArg
      =
      g = Greeter("hey")
      :answer = g.hello()
      -> :answer as Text

    @testDefault
      =
      g = Greeter()
      :answer = g.hello()
      -> :answer as Text

    Greeter
      <greeting Text = "world">
      =
      @hello = -> answer: greeting as Text
      .
  `;

  it('actor with provided constructor arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testWithArg', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'hey' }, to: 'c' } },
    );
  });

  it('actor with default constructor arg', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });
});
