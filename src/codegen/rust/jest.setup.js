// A cache miss runs `cargo build` inside the test, and the actor process it then
// talks to is real async I/O, so the build counts against the test's timeout.
import { jest } from '@jest/globals';

jest.setTimeout(120000);
