import { expectReply, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks — Type | null valid syntax
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type | null — valid syntax', () => {
  it('Integer | null is valid', () => {
    expect(() => compileSource(`@test = { x Integer | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('Text | null is valid', () => {
    expect(() => compileSource(`@test = { x Text | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('Float | null is valid', () => {
    expect(() => compileSource(`@test = { x Float | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('Boolean | null is valid', () => {
    expect(() => compileSource(`@test = { x Boolean | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('List of Integers | null is valid', () => {
    expect(() => compileSource(`@test = { x List of Integers | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('List of Texts | null is valid', () => {
    expect(() => compileSource(`@test = { x List of Texts | null = null; -> result: 0 as Integer }\n`)).not.toThrow();
  });
});

describe('Type | null — plural standalone still errors', () => {
  it('Integers | null throws', () => {
    expect(() => compileSource(`@test = { x Integers | null = null; -> result: 0 as Integer }\n`))
      .toThrow(/'Integers' is not a valid standalone type/);
  });

  it('Texts | null throws', () => {
    expect(() => compileSource(`@test = { x Texts | null = null; -> result: 0 as Integer }\n`))
      .toThrow(/'Texts' is not a valid standalone type/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type | null runtime behaviour
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type | null — runtime behaviour', () => {
  const script = `
      @textNonNull
        =
        msg Text | null = "hello" as Text
        -> result: msg

      @floatNull
        =
        x Float | null = null
        -> result: x
  `;

  it('Text | null var holding a Text value replies correctly', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@textNonNull', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Text | null' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('Float | null var holding null replies correctly', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@floatNull', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Float | null' }, re: { result: null }, to: 'c' },
    });
  });
});
