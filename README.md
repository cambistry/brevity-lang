# Brevity

A tiny Node.js library scaffold meant to be linked as a dev dependency in other projects.

## Install

```bash
npm install --save-dev brevity-lang
```

## Usage

```js
const Brevity = require('brevity-lang');

const brevity = Brevity();
const summary = brevity.summarize('  Keep it short.  ');

console.log(summary); // "Keep it short."
```

## Development

```bash
npm test
```
