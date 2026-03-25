import compile from '../../index.js';
import { createActor, expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// uses — basic parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — basic declaration', () => {
  it('uses without manifest compiles', () => {
    expect(() => compile(`
      uses Remote
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('uses with inline manifest compiles', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
        ping: () -> .
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple uses declarations compile', () => {
    expect(() => compile(`
      uses Alpha {
        foo: () -> (Integer)
      }
      uses Beta {
        bar: (Text) -> .
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — outgoing CAM messages
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — outgoing CAM messages', () => {
  it('silent send produces correct outgoing message', async () => {
    const actor = await createActor(`
      uses Remote {
        ping: () -> .
      }
      @go = { Remote.ping() . }
    `);
    await actor.sendAsync({ id: '1', op: '@go', from: 'c' });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{}, '@ping']);
    expect(outgoing.to).toBe('Remote');
  });

  it('named arg produces correct outgoing CAM', async () => {
    const actor = await createActor(`
      uses Remote {
        greet: (name: Text) -> (greeting: Text)
      }
      @go
        =
        :name : Text
        =
        :greeting : Text = Remote.greet(:name)
        -> :greeting
    `);
    await actor.sendAsync({ id: '1', op: [{ name: 'Alice' }, '@go'], from: 'c', 'bv-a': [{ name: 'Text' }] });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{ name: 'Alice' }, '@greet']);
    expect(outgoing.to).toBe('Remote');
  });

  it('uses without manifest — bare call is silent ping', async () => {
    const actor = await createActor(`
      uses Remote
      @go = { Remote.ping() . }
    `);
    await actor.sendAsync({ id: '1', op: '@go', from: 'c' });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{}, '@ping']);
    expect(outgoing.to).toBe('Remote');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — full roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — full roundtrip', () => {
  it('call out, mock response, return to caller', async () => {
    const actor = await createActor(`
      uses Remote {
        lookup: (key: Text) -> (value: Text)
      }
      @fetch
        =
        :key : Text
        =
        :value : Text = Remote.lookup(:key)
        -> :value
    `);
    // 1. Trigger the handler
    await actor.sendAsync({ id: '42', op: [{ key: 'color' }, '@fetch'], from: 'caller', 'bv-a': [{ key: 'Text' }] });

    // 2. Verify outgoing CAM to Remote
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{ key: 'color' }, '@lookup']);
    expect(outgoing.to).toBe('Remote');

    // 3. Mock Remote's response
    await actor.sendAsync({ id: outgoing.id, re: { value: 'blue' } });

    // 4. Verify final reply to original caller
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('42');
    expect(reply.re).toEqual({ value: 'blue' });
  });

  it('call out with no args, mock response, return named fields', async () => {
    const actor = await createActor(`
      uses Config {
        get_settings: () -> (theme: Text, count: Integer)
      }
      @load
        =
        :theme : Text, :count : Integer = Config.get_settings()
        -> :theme, :count
    `);
    await actor.sendAsync({ id: '1', op: '@load', from: 'ui' });

    const outgoing = actor.posts.find(p => p.to === 'Config');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{}, '@get_settings']);

    await actor.sendAsync({ id: outgoing.id, re: { theme: 'dark', count: 5 } });

    const reply = actor.posts.find(p => p.to === 'ui');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('1');
    expect(reply.re).toEqual({ theme: 'dark', count: 5 });
  });

  it('call out, transform result, return to caller', async () => {
    const actor = await createActor(`
      uses Math {
        double: (n: Integer) -> (result: Integer)
      }
      @compute
        =
        :n : Integer
        =
        :result : Integer = Math.double(:n)
        -> answer: (result + 1) as Integer
    `);
    await actor.sendAsync({ id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }] });

    const outgoing = actor.posts.find(p => p.to === 'Math');
    expect(outgoing.op).toEqual([{ n: 5 }, '@double']);

    await actor.sendAsync({ id: outgoing.id, re: { result: 10 } });

    const reply = actor.posts.find(p => p.to === 'tester');
    expect(reply.id).toBe('7');
    expect(reply.re).toEqual({ answer: 11 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — compile-time checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — compile-time: reject returning remote send result', () => {
  it('-> Remote.call() is rejected', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = -> Remote.call("hi")
    `)).toThrow(/remote send.*fire-and-forget/i);
  });

  it('{ -> Remote.call() } is rejected', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { -> Remote.call("hi") }
    `)).toThrow(/remote send.*fire-and-forget/i);
  });

  it('{ Remote.call() . } is allowed (explicit silent)', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { Remote.call("hi") . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — compile-time argument validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — compile-time: argument validation', () => {
  it('rejects call to undefined function when manifest exists', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { Remote.nope() . }
    `)).toThrow(/has no function 'nope'/);
  });

  it('rejects too many positional args', () => {
    expect(() => compile(`
      uses Remote {
        ping: () -> .
      }
      @go = { Remote.ping("extra") . }
    `)).toThrow(/don't match/);
  });

  it('rejects too few positional args', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { Remote.call() . }
    `)).toThrow(/don't match/);
  });

  it('rejects missing named arg', () => {
    expect(() => compile(`
      uses Remote {
        call: (key: Text) -> (response: Text)
      }
      @go = { Remote.call() . }
    `)).toThrow(/don't match/);
  });

  it('accepts correct positional arg', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { msg : Text = "hi"; Remote.call(msg) . }
    `)).not.toThrow();
  });

  it('accepts correct named arg via sigil shorthand', () => {
    expect(() => compile(`
      uses Remote {
        call: (key: Text) -> (response: Text)
      }
      @go = { key : Text = "test"; Remote.call(:key) . }
    `)).not.toThrow();
  });


  it('accepts correct zero-arg call', () => {
    expect(() => compile(`
      uses Remote {
        ping: () -> .
      }
      @go = { Remote.ping() . }
    `)).not.toThrow();
  });

  it('no manifest — any call is accepted if silent', () => {
    expect(() => compile(`
      uses Remote
      @go = { Remote.anything("whatever") . }
    `)).not.toThrow();
  });

  it('no manifest — returning result is still rejected', () => {
    expect(() => compile(`
      uses Remote
      @go = -> Remote.anything()
    `)).toThrow(/remote send.*fire-and-forget/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — compile-time: type checking
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — compile-time: type checking', () => {
  it('rejects wrong positional type', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { n : Integer = 5; Remote.call(n) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('rejects wrong named arg type', () => {
    expect(() => compile(`
      uses Remote {
        call: (key: Text) -> (response: Text)
      }
      @go = { key : Integer = 5; Remote.call(:key) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('accepts matching positional type', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { msg : Text = "hi"; Remote.call(msg) . }
    `)).not.toThrow();
  });

  it('accepts matching named arg type', () => {
    expect(() => compile(`
      uses Remote {
        call: (key: Text) -> (response: Text)
      }
      @go = { key : Text = "test"; Remote.call(:key) . }
    `)).not.toThrow();
  });

  it('accepts when arg type is unknown (no annotation)', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { Remote.call(msg) . }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — compile-time: assignment of remote results
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — compile-time: result assignment', () => {
  it('rejects assigning result of no-manifest remote', () => {
    expect(() => compile(`
      uses Remote
      @go = { result : Text = Remote.call(); -> :result }
    `)).toThrow(/no declared manifest/);
  });

  it('rejects assigning result of silent function', () => {
    expect(() => compile(`
      uses Remote {
        fire: (Text) -> .
      }
      @go = { result : Text = Remote.fire("bang"); -> :result }
    `)).toThrow(/silent/);
  });

  it('allows assigning result of non-silent function', () => {
    expect(() => compile(`
      uses Remote {
        call: (msg: Text) -> (response: Text)
      }
      @go
        =
        :msg : Text
        =
        :response : Text = Remote.call(:msg)
        -> :response
    `)).not.toThrow();
  });
});
