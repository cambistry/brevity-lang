import compile from '../index.js';
import { runActor } from './helpers.js';

const COUNTER = `
  init()
    $value : Integer = 0

  @get()
    -> $value : Integer
  `;

describe('actor state variables', () => {

  // ── reads ─────────────────────────────────────────────────────────────────

  it('reads initial state after init', async () => {
    const posts = await runActor({
      source: COUNTER,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'client' }));
  });

  // ── writes ────────────────────────────────────────────────────────────────

  it('writes state and persists across dispatches', async () => {
    const source = `
      init
        $value : Integer = 0

      @set(n : Integer)
        $value = n
        -> $value : Integer

      @get()
        -> $value : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: [[42], 'set'], from: 'client', 'bv-a': [['Integer']] },
        { id: '2', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ re: [42] }));
    expect(posts[2]).toEqual(expect.objectContaining({ re: [42] }));
  });

  // ── if-branch write ───────────────────────────────────────────────────────

  it('writes state inside an if branch', async () => {
    const source = `
      init
      $value : Integer = 15

      @clip()
        result : Integer = if $value > 10 { $value = 10 }
        -> result : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'clip', from: 'client' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [10] }),
    ]));
  });

  // ── separated declaration and assignment ──────────────────────────────────

  it('supports separated declaration then assignment in init', async () => {
    const source = `
      init()
        $value : Integer
        $value = 0

      @get()
        -> $value : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'get', from: 'client' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [0] }),
    ]));
  });

  // ── pre-init guard ────────────────────────────────────────────────────────

  it('blocks messages sent before init', async () => {
    const posts = await runActor({
      source: COUNTER,
      receive: [
        { id: '1', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual({
      id: '1',
      ex: 'stateful actor not initialized',
      to: 'client',
    });
  });

  it('unblocks after init is called', async () => {
    const posts = await runActor({
      source: COUNTER,
      receive: [
        { id: '1', op: 'get', from: 'client' },
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '2', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ ex: 'stateful actor not initialized' }));
    expect(posts[posts.length - 1]).toEqual(expect.objectContaining({ id: '2', re: [0] }));
  });

  // ── empty init is not stateful ────────────────────────────────────────────

  it('actor without state vars is not stateful — no init guard', async () => {
    const source = `
      @hello()
        -> 42 : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: '1', op: 'hello', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({ re: [42] }));
  });

  // ── init -> shape ──────────────────────────────────────────────────────

  it('no-arg init replies with { id, re: init, to }', async () => {
    const posts = await runActor({
      source: COUNTER,
      receive: [
        { id: 'i1', cam: 'init', from: 'sys' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'i1', re: 'init', to: 'sys' });
  });

  // ── parameterized init ────────────────────────────────────────────────────

  it('init with positional arg', async () => {
    const source = `
      init(seed : Integer)
        $value : Integer = seed

      @get()
        -> $value : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'i1', cam: [[42], 'init'], 'bv-a': [['Integer']], from: 'sys' },
        { id: '2', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'i1', re: 'init', to: 'sys' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '2', re: [42], to: 'client' }));
  });

  it('init with multiple args', async () => {
    const source = `
      init(a : Integer, b : Text)
        $x : Integer = a
        $y : Text = b

      @get()
        -> $x : Integer
      `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'i1', cam: [[10, 'hello'], 'init'], 'bv-a': [['Integer', 'Text']], from: 'sys' },
        { id: '2', op: 'get', from: 'client' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'i1', re: 'init', to: 'sys' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '2', re: [10], to: 'client' }));
  });

  // ── compile errors ────────────────────────────────────────────────────────

  it('compile error: state var declared but never assigned in init', () => {
    const source = `
      init()
        $x : Integer

      @go()
        -> 0 : Integer
      `;
    expect(() => compile(source)).toThrow(/never assigned/);
  });

  it('compile error: write to state var inside function literal', () => {
    const source = `
    init()
      $x : Integer = 0

    @go()
      fn : (Integer) -> (Integer) = |n : Integer| { $x = 1 }
      -> fn()
      `;
    expect(() => compile(source)).toThrow(/Cannot write to state variable/);
  });

});
