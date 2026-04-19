import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Text methods — simple (no regex, no List return)
// ═══════════════════════════════════════════════════════════════════════════════

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('Text.upper / Text.lower', () => {
  const script = `
      @upper = -> result: Text.upper("hello") as Text
      @lower = -> result: Text.lower("HELLO") as Text
      @upperRef = { t *Text = "hello"; -> result: t.upper as Text }
      @lowerRef = { t *Text = "HELLO"; -> result: t.lower as Text }
      @upperConst = { t Text = "world"; -> result: upper(t) as Text }
  `;

  it('Text.upper literal', async () => {
    await expectBehavior(script, inp('1', '@upper'), out('1', 'Text', 'HELLO'));
  });
  it('Text.lower literal', async () => {
    await expectBehavior(script, inp('2', '@lower'), out('2', 'Text', 'hello'));
  });
  it('ref.upper', async () => {
    await expectBehavior(script, inp('3', '@upperRef'), out('3', 'Text', 'HELLO'));
  });
  it('ref.lower', async () => {
    await expectBehavior(script, inp('4', '@lowerRef'), out('4', 'Text', 'hello'));
  });
  it('upper(const) bare call', async () => {
    await expectBehavior(script, inp('5', '@upperConst'), out('5', 'Text', 'WORLD'));
  });
});

describe('Text.trim / trim_start / trim_end', () => {
  const script = `
      @trim = -> result: Text.trim("  hi  ") as Text
      @trimStart = -> result: Text.trim_start("  hi  ") as Text
      @trimEnd = -> result: Text.trim_end("  hi  ") as Text
      @trimRef = { t *Text = "  ok  "; -> result: t.trim as Text }
  `;

  it('trim both sides', async () => {
    await expectBehavior(script, inp('1', '@trim'), out('1', 'Text', 'hi'));
  });
  it('trim_start', async () => {
    await expectBehavior(script, inp('2', '@trimStart'), out('2', 'Text', 'hi  '));
  });
  it('trim_end', async () => {
    await expectBehavior(script, inp('3', '@trimEnd'), out('3', 'Text', '  hi'));
  });
  it('ref.trim', async () => {
    await expectBehavior(script, inp('4', '@trimRef'), out('4', 'Text', 'ok'));
  });
});

describe('Text.first / Text.last', () => {
  const script = `
      @first = -> result: Text.first("hello") as Text
      @last = -> result: Text.last("hello") as Text
      @firstEmpty = -> result: Text.first("") as Text
      @firstEmoji = -> result: Text.first("\u{1F600}abc") as Text
      @lastRef = { t *Text = "world"; -> result: t.last as Text }
  `;

  it('first scalar', async () => {
    await expectBehavior(script, inp('1', '@first'), out('1', 'Text', 'h'));
  });
  it('last scalar', async () => {
    await expectBehavior(script, inp('2', '@last'), out('2', 'Text', 'o'));
  });
  it('first of empty', async () => {
    await expectBehavior(script, inp('3', '@firstEmpty'), out('3', 'Text', ''));
  });
  it('first of emoji string — full scalar', async () => {
    await expectBehavior(script, inp('4', '@firstEmoji'), out('4', 'Text', '\u{1F600}'));
  });
  it('ref.last', async () => {
    await expectBehavior(script, inp('5', '@lastRef'), out('5', 'Text', 'd'));
  });
});

describe('Text.repeat', () => {
  const script = `
      @repeat = -> result: Text.repeat("ab", 3) as Text
      @repeatRef = { t *Text = "x"; -> result: t.repeat(4) as Text }
      @repeatZero = -> result: Text.repeat("abc", 0) as Text
  `;

  it('repeat 3 times', async () => {
    await expectBehavior(script, inp('1', '@repeat'), out('1', 'Text', 'ababab'));
  });
  it('ref.repeat', async () => {
    await expectBehavior(script, inp('2', '@repeatRef'), out('2', 'Text', 'xxxx'));
  });
  it('repeat 0 times', async () => {
    await expectBehavior(script, inp('3', '@repeatZero'), out('3', 'Text', ''));
  });
});

describe('Text.empty?', () => {
  const script = `
      @emptyTrue = -> result: Text.empty?("") as Boolean
      @emptyFalse = -> result: Text.empty?("x") as Boolean
      @emptyRef = { t *Text = ""; -> result: t.empty? as Boolean }
  `;

  it('empty string is true', async () => {
    await expectBehavior(script, inp('1', '@emptyTrue'), out('1', 'Boolean', true));
  });
  it('non-empty is false', async () => {
    await expectBehavior(script, inp('2', '@emptyFalse'), out('2', 'Boolean', false));
  });
  it('ref.empty?', async () => {
    await expectBehavior(script, inp('3', '@emptyRef'), out('3', 'Boolean', true));
  });
});

describe('Text.slice', () => {
  const script = `
      @sliceFrom = -> result: Text.slice("hello", 1) as Text
      @sliceRange = -> result: Text.slice("hello", 1, 3) as Text
      @sliceRef = { t *Text = "abcde"; -> result: t.slice(0, 2) as Text }
      @sliceEmoji = -> result: Text.slice("a\u{1F600}b", 1, 2) as Text
  `;

  it('slice(1) — from index to end', async () => {
    await expectBehavior(script, inp('1', '@sliceFrom'), out('1', 'Text', 'ello'));
  });
  it('slice(1, 3) — range', async () => {
    await expectBehavior(script, inp('2', '@sliceRange'), out('2', 'Text', 'el'));
  });
  it('ref.slice(0, 2)', async () => {
    await expectBehavior(script, inp('3', '@sliceRef'), out('3', 'Text', 'ab'));
  });
  it('slice across emoji — scalar indexed', async () => {
    await expectBehavior(script, inp('4', '@sliceEmoji'), out('4', 'Text', '\u{1F600}'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern-accepting methods (string args)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text.contains / starts_with / ends_with', () => {
  const script = `
      @containsYes = -> result: Text.contains("hello world", "world") as Boolean
      @containsNo = -> result: Text.contains("hello", "xyz") as Boolean
      @startsWith = -> result: Text.starts_with("hello", "hel") as Boolean
      @startsNo = -> result: Text.starts_with("hello", "ell") as Boolean
      @endsWith = -> result: Text.ends_with("hello", "llo") as Boolean
      @endsNo = -> result: Text.ends_with("hello", "hel") as Boolean
      @containsRef = { t *Text = "foobar"; -> result: t.contains("bar") as Boolean }
  `;

  it('contains match', async () => {
    await expectBehavior(script, inp('1', '@containsYes'), out('1', 'Boolean', true));
  });
  it('contains no match', async () => {
    await expectBehavior(script, inp('2', '@containsNo'), out('2', 'Boolean', false));
  });
  it('starts_with match', async () => {
    await expectBehavior(script, inp('3', '@startsWith'), out('3', 'Boolean', true));
  });
  it('starts_with no match', async () => {
    await expectBehavior(script, inp('4', '@startsNo'), out('4', 'Boolean', false));
  });
  it('ends_with match', async () => {
    await expectBehavior(script, inp('5', '@endsWith'), out('5', 'Boolean', true));
  });
  it('ends_with no match', async () => {
    await expectBehavior(script, inp('6', '@endsNo'), out('6', 'Boolean', false));
  });
  it('ref.contains', async () => {
    await expectBehavior(script, inp('7', '@containsRef'), out('7', 'Boolean', true));
  });
});

describe('Text.index_of', () => {
  const script = `
      @found = -> result: Text.index_of("hello world", "world") as Integer
      @notFound = -> result: Text.index_of("hello", "xyz") as Integer
      @indexRef = { t *Text = "abcde"; -> result: t.index_of("cd") as Integer }
  `;

  it('index_of found', async () => {
    await expectBehavior(script, inp('1', '@found'), out('1', 'Integer', 6));
  });
  it('index_of not found returns -1', async () => {
    await expectBehavior(script, inp('2', '@notFound'), out('2', 'Integer', -1));
  });
  it('ref.index_of', async () => {
    await expectBehavior(script, inp('3', '@indexRef'), out('3', 'Integer', 2));
  });
});

describe('Text.before / Text.after', () => {
  const script = `
      @before = -> result: Text.before("hello-world", "-") as Text
      @after = -> result: Text.after("hello-world", "-") as Text
      @beforeMiss = -> result: Text.before("hello", "x") as Text
      @afterMiss = -> result: Text.after("hello", "x") as Text
      @beforeRef = { t *Text = "foo:bar"; -> result: t.before(":") as Text }
  `;

  it('before separator', async () => {
    await expectBehavior(script, inp('1', '@before'), out('1', 'Text', 'hello'));
  });
  it('after separator', async () => {
    await expectBehavior(script, inp('2', '@after'), out('2', 'Text', 'world'));
  });
  it('before no match returns whole text', async () => {
    await expectBehavior(script, inp('3', '@beforeMiss'), out('3', 'Text', 'hello'));
  });
  it('after no match returns empty', async () => {
    await expectBehavior(script, inp('4', '@afterMiss'), out('4', 'Text', ''));
  });
  it('ref.before', async () => {
    await expectBehavior(script, inp('5', '@beforeRef'), out('5', 'Text', 'foo'));
  });
});

describe('Text.replace / Text.replace_first', () => {
  const script = `
      @replaceAll = -> result: Text.replace("aabaa", "a", "x") as Text
      @replaceFirst = -> result: Text.replace_first("aabaa", "a", "x") as Text
      @replaceRef = { t *Text = "hello world"; -> result: t.replace("o", "0") as Text }
  `;

  it('replace all occurrences', async () => {
    await expectBehavior(script, inp('1', '@replaceAll'), out('1', 'Text', 'xxbxx'));
  });
  it('replace_first — only first occurrence', async () => {
    await expectBehavior(script, inp('2', '@replaceFirst'), out('2', 'Text', 'xabaa'));
  });
  it('ref.replace', async () => {
    await expectBehavior(script, inp('3', '@replaceRef'), out('3', 'Text', 'hell0 w0rld'));
  });
});

// split and lines tests deferred to Phase 4 — List return type integration
