'use strict';

function compile(source) {
  if (typeof source !== 'string') {
    throw new TypeError('compile expects a string');
  }

  return {
    output: '',
    manifest: { structures: [] },
    sourcemap: null,
    errors: [],
  };
}

module.exports = compile;
