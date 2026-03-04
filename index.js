'use strict';

function Brevity() {
  return {
    summarize(text) {
      if (typeof text !== 'string') {
        throw new TypeError('Brevity.summarize expects a string');
      }

      return text.trim();
    }
  };
}

module.exports = Brevity;
