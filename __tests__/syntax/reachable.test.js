import { compileSource } from '../helpers.js';

// An actor answers something: a public or protected name, a published param, a
// `new`, a type. One with only private names reaches no one, and is a compile error.
// A protected-only actor answering at runtime: cam_test/get.test.js.
describe('an actor anyone can reach', () => {
  it('only private names is an error', () => {
    expect(() => compileSource(`
      #f = () -> 1
      #g = () -> 2
    `)).toThrow('This actor has nothing anyone can reach: give it a public or protected name');
  });

  it('only dependencies is an error', () => {
    expect(() => compileSource(`
      use DB = "/db" as { get (key: Text) -> (value: Text) }
    `)).toThrow('This actor has nothing anyone can reach');
  });

  it('a protected function', () => {
    expect(() => compileSource(`
      f = () -> 1
    `)).not.toThrow();
  });

  it('a protected cell', () => {
    expect(() => compileSource(`
      n *Integer = 0
    `)).not.toThrow();
  });

  it('only types', () => {
    expect(() => compileSource(`
      type Point(Integer, Integer)
    `)).not.toThrow();
  });

  it('a class', () => {
    expect(() => compileSource(`
      *(t Text) { @get = () -> t }
    `)).not.toThrow();
  });
});
