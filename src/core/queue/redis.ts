import IORedis, { type RedisOptions } from 'ioredis';

const globalForRedis = globalThis as unknown as {
  nexusRedisConnection?: IORedis;
};

export function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

export function getRedisConnection(): IORedis {
  if (!globalForRedis.nexusRedisConnection) {
    const options: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    };
    globalForRedis.nexusRedisConnection = new IORedis(getRedisUrl(), options);
  }
  return globalForRedis.nexusRedisConnection;
}

export async function checkRedisConnection(timeoutMs = 3000): Promise<boolean> {
  const connection = getRedisConnection();
  try {
    await Promise.race([
      connection.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
