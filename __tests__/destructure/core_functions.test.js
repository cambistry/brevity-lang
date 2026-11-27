import { compileSource, expectBehavior } from '../helpers.js';

// A core type's functions are destructured from it, as from any value: then called
// by name. `size: textSize = Text` renames. At file level the names are every
// actor's in the file.
describe('a core type\'s functions, destructured', () => {
  const script = `
    :before, :after, :trim = Text
    :take, :from = List
    size: textSize = Text

    field = (front Text, key Text) -> front |> after("#{key}:") |> before(";") |> trim
    @field = (front Text) {
      v Text = field(front, "b")
      return v
    }
    @list = () {
      xs List[Integer] = [1, 2, 3, 4]
      v List[Integer] = take(from(xs, 1), 2)
      return v
    }
    @renamed = (t Text) {
      v Integer = textSize(t)
      return v
    }
    @inBody = (t Text) {
      :upper = Text
      v Text = upper(t)
      return v
    }
    C = *(t Text) {
      @trimmed = () -> trim(t)
    }
    @inClass = (t Text) {
      c = C(t)
      v Text = c.trimmed()
      return v
    }
  `;

  it('at file level, piped', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['a:1; b: two ;c:3'], 'field'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: ['two'], ty: ['Text'], to: 'c' } },
    );
  });

  it('a List\'s functions, and a rename', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'list', from: 'c' } },
      { output: { id: '1', re: [[2, 3]], ty: ['List[Integer]'], to: 'c' } },
      { input: { id: '2', op: [['hello'], 'renamed'], ty: [['Text']], from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a body, and in a class of the file', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['hi'], 'inBody'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: ['HI'], ty: ['Text'], to: 'c' } },
      { input: { id: '2', op: [['  x  '], 'inClass'], ty: [['Text']], from: 'c' } },
      { output: { id: '2', re: ['x'], ty: ['Text'], to: 'c' } },
    );
  });
});

describe('a core type\'s functions — compile errors', () => {
  it('a name taken from two types', () => {
    expect(() => compileSource(`
      :size = Text
      :size = List
    `)).toThrow("'size' is declared twice (Text's and List's): rename one, 'size: other = List'");
  });

  it('a name the type has no function for', () => {
    expect(() => compileSource(`
      :nope = Text
    `)).toThrow("Text has no function 'nope'");
  });

  it('a keyword', () => {
    expect(() => compileSource(`
      :repeat = Text
    `)).toThrow("'repeat' is a keyword: bind Text's 'repeat' under another name, 'repeat: other = Text'");
  });

  it('not destructured, a core function is called by its type', () => {
    expect(() => compileSource(`
      @g = (t Text) {
        v Text = upper(t)
        return v
      }
    `)).toThrow("'upper' is not defined");
  });
});
