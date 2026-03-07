import { getRedis } from "./redis";

type RateLimitRedis = {
  expire(key: string, seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
};

type FixedWindowLimit = {
  name: string;
  identifier: string;
  maxRequests: number;
  windowSeconds: number;
  errorMessage: string;
};

const SESSION_CREATE_GLOBAL_LIMIT = 30;
const SESSION_CREATE_USER_LIMIT = 5;
const SESSION_CREATE_WINDOW_SECONDS = 60;
const PAIRING_GENERATION_LIMIT = 5;
const PAIRING_GENERATION_WINDOW_SECONDS = 10 * 60;
const PAIRING_REDEMPTION_GLOBAL_LIMIT = 60;
const PAIRING_REDEMPTION_CODE_LIMIT = 5;
const PAIRING_REDEMPTION_WINDOW_SECONDS = 10 * 60;

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export function rateLimitResponse(error: RateLimitError): Response {
  return Response.json(
    {
      error: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(error.retryAfterSeconds),
      },
    }
  );
}

function limitKey(args: FixedWindowLimit, bucketStart: number): string {
  return `ratelimit:${args.name}:${args.identifier}:${bucketStart}`;
}

function retryAfterSeconds(windowSeconds: number, nowMs: number): number {
  const windowMs = windowSeconds * 1000;
  const bucketStart = Math.floor(nowMs / windowMs) * windowMs;
  return Math.max(1, Math.ceil((bucketStart + windowMs - nowMs) / 1000));
}

export async function enforceFixedWindowLimitForRedis(
  redis: RateLimitRedis,
  args: FixedWindowLimit
): Promise<void> {
  const nowMs = Date.now();
  const windowMs = args.windowSeconds * 1000;
  const bucketStart = Math.floor(nowMs / windowMs) * windowMs;
  const key = limitKey(args, bucketStart);
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, args.windowSeconds);
  }

  if (count > args.maxRequests) {
    throw new RateLimitError(
      args.errorMessage,
      retryAfterSeconds(args.windowSeconds, nowMs)
    );
  }
}

export async function enforcePairingGenerationLimitForRedis(
  redis: RateLimitRedis,
  userId: string
): Promise<void> {
  await enforceFixedWindowLimitForRedis(redis, {
    name: "pairing-generate",
    identifier: userId,
    maxRequests: PAIRING_GENERATION_LIMIT,
    windowSeconds: PAIRING_GENERATION_WINDOW_SECONDS,
    errorMessage:
      "Too many new connector codes have been requested for this account. Wait a few minutes and refresh /connector again.",
  });
}

export async function enforcePairingGenerationLimit(
  userId: string
): Promise<void> {
  await enforcePairingGenerationLimitForRedis(getRedis(), userId);
}

export async function enforcePairingRedemptionLimitsForRedis(
  redis: RateLimitRedis,
  normalizedCode: string | null
): Promise<void> {
  await enforceFixedWindowLimitForRedis(redis, {
    name: "pairing-redeem-global",
    identifier: "all",
    maxRequests: PAIRING_REDEMPTION_GLOBAL_LIMIT,
    windowSeconds: PAIRING_REDEMPTION_WINDOW_SECONDS,
    errorMessage:
      "Too many pairing-code authentication attempts are happening right now. Wait a few minutes and try again.",
  });

  if (!normalizedCode) {
    return;
  }

  await enforceFixedWindowLimitForRedis(redis, {
    name: "pairing-redeem-code",
    identifier: normalizedCode,
    maxRequests: PAIRING_REDEMPTION_CODE_LIMIT,
    windowSeconds: PAIRING_REDEMPTION_WINDOW_SECONDS,
    errorMessage:
      "This three-word connector code has been tried too many times. Open /connector and generate a fresh code before trying again.",
  });
}

export async function enforcePairingRedemptionLimits(
  normalizedCode: string | null
): Promise<void> {
  await enforcePairingRedemptionLimitsForRedis(getRedis(), normalizedCode);
}

export async function enforceSessionCreateLimitsForRedis(
  redis: RateLimitRedis,
  userId: string
): Promise<void> {
  await enforceFixedWindowLimitForRedis(redis, {
    name: "session-create-global",
    identifier: "all",
    maxRequests: SESSION_CREATE_GLOBAL_LIMIT,
    windowSeconds: SESSION_CREATE_WINDOW_SECONDS,
    errorMessage:
      "Too many sandbox sessions are being started right now. Wait a minute and try again.",
  });

  await enforceFixedWindowLimitForRedis(redis, {
    name: "session-create-user",
    identifier: userId,
    maxRequests: SESSION_CREATE_USER_LIMIT,
    windowSeconds: SESSION_CREATE_WINDOW_SECONDS,
    errorMessage:
      "Too many sandbox sessions have been started for this account in the last minute. Wait a minute and try again.",
  });
}

export async function enforceSessionCreateLimits(
  userId: string
): Promise<void> {
  await enforceSessionCreateLimitsForRedis(getRedis(), userId);
}
