import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// Blob — basic type declaration and usage
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob — declaration and return', () => {
  const script = `
      @constBlob
        =
        b Blob = "hello"
        -> result: b as Blob

      @refBlob
        =
        b *Blob = "hello"
        -> result: b as Blob

      @refMutate
        =
        b *Blob = "hello"
        b <- "world"
        -> result: b as Blob
  `;

  it('Blob constant declaration', async () => {
    await expectBehavior(script, inp('1', '@constBlob'), out('1', 'Blob', 'hello'));
  });

  it('Blob ref declaration', async () => {
    await expectBehavior(script, inp('2', '@refBlob'), out('2', 'Blob', 'hello'));
  });

  it('Blob ref mutation', async () => {
    await expectBehavior(script, inp('3', '@refMutate'), out('3', 'Blob', 'world'));
  });
});

describe('Blob — casting', () => {
  const script = `
      @textToBlob
        =
        t Text = "hello"
        b Blob = t as Blob
        -> result: Blob.size(b) as Integer

      @blobToText
        =
        b Blob = "hello"
        t Text = b as Text
        -> result: Text.upper(t) as Text
  `;

  it('Text as Blob — byte-level size', async () => {
    await expectBehavior(script, inp('1', '@textToBlob'), out('1', 'Integer', 5));
  });

  it('Blob as Text — Unicode operations available', async () => {
    await expectBehavior(script, inp('2', '@blobToText'), out('2', 'Text', 'HELLO'));
  });
});

describe('Blob — size (byte count)', () => {
  const script = `
      @ascii
        =
        -> result: Blob.size("hello") as Integer

      @multibyte
        =
        -> result: Blob.size("\u{00E9}") as Integer

      @emoji
        =
        -> result: Blob.size("\u{1F600}") as Integer

      @empty
        =
        -> result: Blob.size("") as Integer

      @refSize
        =
        b *Blob = "hello"
        -> result: b.size as Integer
  `;

  it('ascii — 1 byte per char', async () => {
    await expectBehavior(script, inp('1', '@ascii'), out('1', 'Integer', 5));
  });

  it('e-acute — 2 bytes in UTF-8', async () => {
    await expectBehavior(script, inp('2', '@multibyte'), out('2', 'Integer', 2));
  });

  it('emoji — 4 bytes in UTF-8', async () => {
    await expectBehavior(script, inp('3', '@emoji'), out('3', 'Integer', 4));
  });

  it('empty — 0 bytes', async () => {
    await expectBehavior(script, inp('4', '@empty'), out('4', 'Integer', 0));
  });

  it('ref.size — byte count', async () => {
    await expectBehavior(script, inp('5', '@refSize'), out('5', 'Integer', 5));
  });
});
