// Browser tests share one Chromium for the run (./jest.global_setup.js). Each
// test file connects on first use and closes its own harness when it ends; the
// pages a test loads go back to the pool after it, for the next test.
import { jest, afterAll, afterEach } from '@jest/globals';
import { closeHarness, releaseTestPages } from './harness.js';

jest.setTimeout(30000);
afterEach(() => releaseTestPages());
afterAll(() => closeHarness());
