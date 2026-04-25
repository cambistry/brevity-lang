import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks — Type | null valid syntax
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type | null — valid syntax', () => {
  it('Integer | null is valid', () => {
    expect(() => compileSource(`@test = { x Integer | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('Text | null is valid', () => {
    expect(() => compileSource(`@test = { x Text | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('Float | null is valid', () => {
    expect(() => compileSource(`@test = { x Float | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('Boolean | null is valid', () => {
    expect(() => compileSource(`@test = { x Boolean | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('List of Integers | null is valid', () => {
    expect(() => compileSource(`@test = { x List of Integers | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('List of Texts | null is valid', () => {
    expect(() => compileSource(`@test = { x List of Texts | null = null; -> result: 0 }\n`)).not.toThrow();
  });
});

describe('Type | null — plural standalone still errors', () => {
  it('Integers | null throws', () => {
    expect(() => compileSource(`@test = { x Integers | null = null; -> result: 0 }\n`))
      .toThrow(/'Integers' is not a valid standalone type/);
  });

  it('Texts | null throws', () => {
    expect(() => compileSource(`@test = { x Texts | null = null; -> result: 0 }\n`))
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
        msg Text | null = "hello"
        -> result: msg

      @floatNull
        =
        x Float | null = null
        -> result: x
  `;

  it('Text | null var holding a Text value replies correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@textNonNull', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text | null' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('Float | null var holding null replies correctly', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@floatNull', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Float | null' }, re: { result: null }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// General unions — multi-member, non-null
// ═══════════════════════════════════════════════════════════════════════════════

describe('General unions — valid syntax', () => {
  it('Integer | Text in actor field', () => {
    expect(() => compileSource(`@test = { x Integer | Text = 1; -> result: 0 }\n`)).not.toThrow();
  });

  it('Integer | Text | Boolean in actor field', () => {
    expect(() => compileSource(`@test = { x Integer | Text | Boolean = true; -> result: 0 }\n`)).not.toThrow();
  });

  it('Integer | Text | null in actor field', () => {
    expect(() => compileSource(`@test = { x Integer | Text | null = null; -> result: 0 }\n`)).not.toThrow();
  });

  it('List of Integers | Text in actor field', () => {
    expect(() => compileSource(`@test = { xs List of Integers | Text = "hi"; -> result: 0 }\n`)).not.toThrow();
  });

  it('Integer | Text in lineal param block', () => {
    expect(() => compileSource(`@id\n  =\n  x Integer | Text\n  =\n  -> result: x\n`)).not.toThrow();
  });

  it('Integer | Text in return as-clause', () => {
    expect(() => compileSource(`@pick\n  =\n  flag Boolean\n  =\n  -> result as Integer | Text\n`)).not.toThrow();
  });

  it('plural standalone in multi-member union still errors', () => {
    expect(() => compileSource(`@test = { x Integers | Text = 1; -> result: 0 }\n`))
      .toThrow(/'Integers' is not a valid standalone type/);
  });
});

describe('General unions — call-site assignability', () => {
  const callerScript = (callArg) => `
      use = |x Integer | Text| -> result: x as Integer | Text
      @test
        =
        =
        :result = use(${callArg})
        -> :result
  `;

  it('Integer literal is assignable to Integer | Text', () => {
    expect(() => compileSource(callerScript('42'))).not.toThrow();
  });

  it('Text literal is assignable to Integer | Text', () => {
    expect(() => compileSource(callerScript('"hi"'))).not.toThrow();
  });

  it('Boolean literal is rejected by Integer | Text', () => {
    expect(() => compileSource(callerScript('true')))
      .toThrow(/'Boolean' is not assignable to 'Integer \| Text'/);
  });
});

describe('General unions — runtime behaviour', () => {
  const script = `
      @intSlot
        =
        x Integer | Text = 42
        -> result: x

      @textSlot
        =
        x Integer | Text = "hi"
        -> result: x

      @echo
        =
        x Integer | Text
        =
        -> result: x
  `;

  it('Integer | Text slot holding an Integer replies correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@intSlot', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer | Text' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('Integer | Text slot holding a Text replies correctly', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@textSlot', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer | Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });

  it('Integer | Text public param accepts an Integer', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[99], '@echo'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer | Text' }, re: { result: 99 }, to: 'c' } },
    );
  });

  it('Integer | Text public param accepts a Text', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [['hi'], '@echo'], 'bv-a': [['Text']], from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer | Text' }, re: { result: 'hi' }, to: 'c' } },
    );
  });
});
