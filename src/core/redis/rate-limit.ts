import { getRedisConnection } from '@/core/queue/redis';

export type RedisRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRedisFixedWindowLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RedisRateLimitResult> {
  const redis = getRedisConnection();
  const result = await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then
       redis.call('EXPIRE', KEYS[1], ARGV[1])
     end
     local ttl = redis.call('TTL', KEYS[1])
     return {count, ttl}`,
    1,
    input.key,
    String(input.windowSeconds),
  ) as unknown as [number | string, number | string];

  const requestCount = Number(result[0]);
  const ttl = Number(result[1]);
  const allowed = requestCount <= input.limit;

  return {
    allowed,
    remaining: Math.max(0, input.limit - requestCount),
    retryAfterSeconds: ttl > 0 ? ttl : input.windowSeconds,
  };
}
