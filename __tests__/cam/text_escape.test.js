import { expectBehavior } from '../helpers.js';

// Text is plain in a program. On the wire a literal `#<` is `\#<` and a literal `\` is
// `\\`: a value tagged `Text` is unescaped coming in and escaped going out
// (notes/opre-text-and-addresses-2026-11-27.md). `Text.size` shows what the program
// sees.

describe('Text on the wire', () => {
  const script = `
    @size = (t Text) { k Integer = Text.size(t); return k }
    @echo = (t Text) -> t
    @say = () -> "see #<:x>"
  `;

  it('an escaped #< arrives as a plain #<', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['a \\#<b>'], 'size'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', ty: ['Integer'], re: [6], to: 'c' } },
    );
  });

  it('an escaped backslash arrives as one backslash', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [['a\\\\b'], 'size'], ty: [['Text']], from: 'c' } },
      { output: { id: '2', ty: ['Integer'], re: [3], to: 'c' } },
    );
  });

  it('a Text goes back out escaped as it came', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [['a \\#<b> \\\\'], 'echo'], ty: [['Text']], from: 'c' } },
      { output: { id: '3', ty: ['Text'], re: ['a \\#<b> \\\\'], to: 'c' } },
    );
  });

  it("a Text the program makes goes out escaped", async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'say', from: 'c' } },
      { output: { id: '4', ty: ['Text'], re: ['see \\#<:x>'], to: 'c' } },
    );
  });
});
