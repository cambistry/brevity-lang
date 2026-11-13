import { split, join, quote, isRelative, under, resolve, mapBracketed } from '../../src/codegen/opre_tokens.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Opre addresses as tokens: space-delimited, quoted only when they must be, and a
// head token `.` that makes an address relative to its sender.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
// ═══════════════════════════════════════════════════════════════════════════════

describe('split and join', () => {
  it.each([
    ['factory.bv s get', ['factory.bv', 's', 'get']],
    ['. Box 1', [null, 'Box', '1']],
    ['.', [null]],
    ["'file/with spaces/' Name", ['file/with spaces/', 'Name']],
    ["'this isn''t ready'", ["this isn't ready"]],
    ["Chris's-Computer s", ["Chris's-Computer", 's']],
    ["'''tis'", ["'tis"]],
    ["'.' abc", ['.', 'abc']],
    ['.hidden.file @foreign', ['.hidden.file', '@foreign']],
    ['#tag x', ['#tag', 'x']],
    ['~x y', ['~x', 'y']],
    ['$x y', ['$x', 'y']],
    ['@ xyz', ['@', 'xyz']],
    ['main @foreign ~x #tag $x', ['main', '@foreign', '~x', '#tag', '$x']],
    ['', []],
  ])('%s', (address, tokens) => {
    expect(split(address)).toEqual(tokens);
    expect(join(tokens)).toBe(address);
  });
});

describe('quote', () => {
  it.each([
    ['plain', 'plain'],
    ['has space', "'has space'"],
    ["isn't spaced", "'isn''t spaced'"],
    ["Chris's", "Chris's"],
    ["'tis", "'''tis'"],
    ['.', "'.'"],
    ['.x', '.x'],
    [null, '.'],
    ['@x', '@x'],
  ])('%s', (token, written) => {
    expect(quote(token)).toBe(written);
  });
});

describe('malformed addresses', () => {
  it.each([
    ["'no-spaces-here'", /quoted but needn't be/],
    ["a 'b'", /quoted but needn't be/],
    ["'unclosed", /unclosed quote/],
    ["'a b'c", /after a closing quote/],
    ['a  b', /empty token/],
    ['a ', /empty token/],
    [' a', /empty token/],
    ['a . b', /only an address's head token/],
  ])('%s', (address, error) => {
    expect(() => split(address)).toThrow(error);
  });
});

it('join refuses self after the head', () => {
  expect(() => join(['a', null])).toThrow(/only an address's head token/);
});

describe('isRelative', () => {
  it.each([
    ['.', true],
    ['. x', true],
    ['. Box 1', true],
    ['.hidden.file', false],
    ['.hidden.file x', false],
    ["'.' abc", false],
    ['@foreign', false],
    ['#tag x', false],
    ['~x y', false],
    ['$x y', false],
    ['@ xyz', false],
    ['@', false],
    ['main s', false],
    ['', false],
  ])('%s', (address, relative) => {
    expect(isRelative(address)).toBe(relative);
  });
});

describe('translation', () => {
  it.each([
    ['.', 'c', '. c'],
    ['. x', 'c', '. c x'],
    ['. x', 'Box 1', '. Box 1 x'],
    ['main s', 'c', 'main s'],
    ['.hidden.file', 'c', '.hidden.file'],
    ['#tag x', 'c', '#tag x'],
    ['~x y', 'c', '~x y'],
    ['$x y', 'c', '$x y'],
    ['@ xyz', 'c', '@ xyz'],
    ['main @foreign ~x', 'c', 'main @foreign ~x'],
    ["'has space' x", 'c', "'has space' x"],
    [". 'has space' x", 'c', ". c 'has space' x"],
    [". 'it''s' x", 'Box 1', ". Box 1 'it''s' x"],
  ])('under: %s from child %s', (address, name, translated) => {
    expect(under(address, name)).toBe(translated);
  });

  it.each([
    ['.', 'app.bv', 'app.bv'],
    ['. x', 'app.bv', 'app.bv x'],
    ['. Box 1 tally', "'my app.bv'", "'my app.bv' Box 1 tally"],
    ['@foreign x', 'app.bv', '@foreign x'],
    ['.hidden.file x', 'app.bv', '.hidden.file x'],
    ['#tag x', 'app.bv', '#tag x'],
    ['@ xyz', 'app.bv', '@ xyz'],
    [". 'has space' x", "'my app.bv'", "'my app.bv' 'has space' x"],
  ])('resolve: %s at %s', (address, self, translated) => {
    expect(resolve(address, self)).toBe(translated);
  });
});

// `#<…>` in a payload string, with the escapes of
// notes/address-delimiter-change-plan-2026-04-23.md: `\\` is a literal
// backslash everywhere, `\>` a literal `>` inside the brackets, `\#<` a literal
// `#<` outside them.
describe('bracketed addresses in a payload', () => {
  it.each([
    ['#<. x>', '#<. c x>'],
    ['see #<. x> and #<main y>', 'see #<. c x> and #<main y>'],
    ['#<#tag x>', '#<#tag x>'],
    ["#<'has space' x>", "#<'has space' x>"],
    ["#<. 'has space'>", "#<. c 'has space'>"],
    ['#<. a\\>b>', '#<. c a\\>b>'],
    ['#<a\\> #<. b>', '#<a\\> #<. b>'],
    ['#<. a\\\\>', '#<. c a\\\\>'],
    ['\\#<. x>', '\\#<. x>'],
    ['\\\\#<. x>', '\\\\#<. c x>'],
  ])('%s', (payload, translated) => {
    expect(mapBracketed(payload, a => under(a, 'c'))).toBe(translated);
  });
});
