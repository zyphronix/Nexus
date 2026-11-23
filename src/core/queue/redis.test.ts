import { afterEach, describe, expect, it } from 'vitest';
import { getRedisUrl } from './redis';

afterEach(() => {
  delete process.env.REDIS_URL;
});

describe('getRedisUrl', () => {
  it('defaults to the local Redis endpoint', () => {
    delete process.env.REDIS_URL;
    expect(getRedisUrl()).toBe('redis://127.0.0.1:6379');
  });

  it('uses a configured hosted Redis URL', () => {
    process.env.REDIS_URL = 'rediss://redis.example:6380';
    expect(getRedisUrl()).toBe('rediss://redis.example:6380');
  });
});
