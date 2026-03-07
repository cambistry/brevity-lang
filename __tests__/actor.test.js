import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('actors', () => {
  it('actor declaration — named class, named export', async () => {
    const source = `actor User\n\non hello\n\n  reply answer: "world" : Text\n\nend#User\n`;
    const { output } = compile(source);
    const User = await evaluate(output, 'User');
    const binding = { post: jest.fn() };
    const actor = new User(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('multiple actor definitions — named exports', async () => {
    const source = [
      'actor Greeter',
      '',
      'on hello',
      '',
      '  reply answer: "world" : Text',
      '',
      'end#Greeter',
      '',
      'actor Echo',
      '',
      'on echo(:text : Text) reply(:text : Text)',
      '',
      'end#Echo',
    ].join('\n');
    const { output } = compile(source);

    const Greeter = await evaluate(output, 'Greeter');
    const greeterBinding = { post: jest.fn() };
    new Greeter(greeterBinding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(greeterBinding.post).toHaveBeenCalledWith({
      id: '1',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });

    const Echo = await evaluate(output, 'Echo');
    const echoBinding = { post: jest.fn() };
    new Echo(echoBinding).receive({ id: '2', op: { echo: { text: 'abc' } }, 'bv-a': { echo: { text: 'Text' } }, from: 'caller' });
    expect(echoBinding.post).toHaveBeenCalledWith({
      id: '2',
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });
});
