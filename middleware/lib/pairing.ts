import { randomInt } from "node:crypto";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { enforcePairingGenerationLimitForRedis } from "./rate-limit";
import { getRedis } from "./redis";
import type { PairingCodeRecord, PairingUserRecord } from "./types.js";

type PairingWebsiteUser = {
  id: string;
  login: string | null;
};

type PairingRedis = {
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get<T>(key: string): Promise<T | null>;
  getdel<T>(key: string): Promise<T | null>;
  incr(key: string): Promise<number>;
  set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean }
  ): Promise<unknown>;
};

const PAIRING_CODE_TTL_SECONDS = 10 * 60;
const PAIRING_WORD_COUNT = 3;

function codeKey(code: string): string {
  return `pairing:code:${code}`;
}

function userKey(userId: string): string {
  return `pairing:user:${userId}`;
}

function generatePairingCode(): string {
  const words: string[] = [];
  for (let index = 0; index < PAIRING_WORD_COUNT; index += 1) {
    words.push(wordlist[randomInt(0, wordlist.length)]);
  }
  return words.join(" ");
}

export function normalizePairingCode(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (normalized.length !== PAIRING_WORD_COUNT) {
    throw new Error("Pairing codes must contain exactly three words.");
  }

  return normalized.join(" ");
}

export async function getOrCreatePairingCode(
  user: PairingWebsiteUser
): Promise<{ code: string; expiresAt: number }> {
  return getOrCreatePairingCodeForRedis(getRedis(), user);
}

export async function getOrCreatePairingCodeForRedis(
  redis: PairingRedis,
  user: PairingWebsiteUser
): Promise<{ code: string; expiresAt: number }> {
  const existing = await redis.get<PairingUserRecord>(userKey(user.id));

  if (existing?.code && existing.expiresAt > Date.now()) {
    return existing;
  }

  await enforcePairingGenerationLimitForRedis(redis, user.id);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePairingCode();
    const expiresAt = Date.now() + PAIRING_CODE_TTL_SECONDS * 1000;
    const record: PairingCodeRecord = {
      code,
      userId: user.id,
      userLogin: user.login,
      expiresAt,
    };

    const reserved = await redis.set(codeKey(code), record, {
      ex: PAIRING_CODE_TTL_SECONDS,
      nx: true,
    });

    if (reserved === "OK") {
      const userRecord: PairingUserRecord = { code, expiresAt };
      await redis.set(userKey(user.id), userRecord, {
        ex: PAIRING_CODE_TTL_SECONDS,
      });
      return userRecord;
    }
  }

  throw new Error("Failed to generate a unique pairing code.");
}

export async function redeemPairingCode(input: string): Promise<{
  userId: string;
  userLogin: string | null;
  code: string;
} | null> {
  return redeemPairingCodeForRedis(getRedis(), input);
}

export async function readPairingCode(input: string): Promise<{
  userId: string;
  userLogin: string | null;
  code: string;
} | null> {
  return readPairingCodeForRedis(getRedis(), input);
}

async function clearUserCodeIfCurrent(
  redis: PairingRedis,
  record: PairingCodeRecord
): Promise<void> {
  const currentUserRecord = await redis.get<PairingUserRecord>(userKey(record.userId));
  if (currentUserRecord?.code === record.code) {
    await redis.del(userKey(record.userId));
  }
}

export async function readPairingCodeForRedis(
  redis: PairingRedis,
  input: string
): Promise<{
  userId: string;
  userLogin: string | null;
  code: string;
} | null> {
  let normalized: string;
  try {
    normalized = normalizePairingCode(input);
  } catch {
    return null;
  }

  const record = await redis.get<PairingCodeRecord>(codeKey(normalized));
  if (!record) {
    return null;
  }

  if (record.expiresAt < Date.now()) {
    await redis.del(codeKey(normalized));
    await clearUserCodeIfCurrent(redis, record);
    return null;
  }

  return {
    userId: record.userId,
    userLogin: record.userLogin ?? null,
    code: record.code,
  };
}

export async function redeemPairingCodeForRedis(
  redis: PairingRedis,
  input: string
): Promise<{
  userId: string;
  userLogin: string | null;
  code: string;
} | null> {
  let normalized: string;
  try {
    normalized = normalizePairingCode(input);
  } catch {
    return null;
  }

  const record = await redis.getdel<PairingCodeRecord>(codeKey(normalized));
  if (!record || record.expiresAt < Date.now()) {
    if (record) {
      await clearUserCodeIfCurrent(redis, record);
    }
    return null;
  }

  await clearUserCodeIfCurrent(redis, record);

  return {
    userId: record.userId,
    userLogin: record.userLogin ?? null,
    code: record.code,
  };
}
