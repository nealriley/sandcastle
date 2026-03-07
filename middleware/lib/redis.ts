import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | null {
  return values.find((candidate) => candidate && candidate.trim()) ?? null;
}

function getRedisConfig() {
  const url = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
    process.env.KV_URL,
    process.env.REDIS_URL
  );
  const token = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN
  );

  if (!url || !token) {
    throw new Error(
      "Missing Redis configuration. Expected UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_URL/KV_REST_API_TOKEN."
    );
  }

  return { url, token };
}

export function assertRedisConfiguration(): void {
  getRedisConfig();
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(getRedisConfig());
  }

  return redisClient;
}
