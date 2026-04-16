// Browser tests pay chromium-launch latency on the first call per worker.
import { jest } from '@jest/globals';
jest.setTimeout(30000);
