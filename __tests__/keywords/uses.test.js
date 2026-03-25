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
