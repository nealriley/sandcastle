import type { UserEnvironmentVariable } from "./types.js";
import { getRedis } from "./redis";
import { normalizeEnvironmentKey, validateEnvironmentEntry } from "./environment-rules";

type UserEnvironmentRedis = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
};

const MAX_STORED_ENVIRONMENT_VARIABLES = 64;

function userEnvironmentKey(userId: string): string {
  return `user_environment:${userId}`;
}

function isUserEnvironmentVariable(
  value: unknown
): value is UserEnvironmentVariable {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.value === "string" &&
    typeof candidate.secret === "boolean" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

function normalizeStoredVariables(
  stored: unknown
): UserEnvironmentVariable[] {
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored
    .filter(isUserEnvironmentVariable)
    .map((variable) => ({
      key: normalizeEnvironmentKey(variable.key),
      value: variable.value,
      secret: variable.secret,
      createdAt: variable.createdAt,
      updatedAt: variable.updatedAt,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export async function listUserEnvironmentVariables(
  userId: string
): Promise<UserEnvironmentVariable[]> {
  return listUserEnvironmentVariablesInRedis(getRedis(), userId);
}

export async function listUserEnvironmentVariablesInRedis(
  redis: UserEnvironmentRedis,
  userId: string
): Promise<UserEnvironmentVariable[]> {
  const stored = await redis.get<unknown>(userEnvironmentKey(userId));
  return normalizeStoredVariables(stored);
}

export async function upsertUserEnvironmentVariable(args: {
  userId: string;
  key: string;
  value: string;
  secret: boolean;
}): Promise<UserEnvironmentVariable[]> {
  return upsertUserEnvironmentVariableInRedis(getRedis(), args);
}

export async function upsertUserEnvironmentVariableInRedis(
  redis: UserEnvironmentRedis,
  args: {
    userId: string;
    key: string;
    value: string;
    secret: boolean;
  }
): Promise<UserEnvironmentVariable[]> {
  const validated = validateEnvironmentEntry({
    key: args.key,
    value: args.value,
  });
  const current = await listUserEnvironmentVariablesInRedis(redis, args.userId);
  const now = Date.now();
  const existing = current.find((variable) => variable.key === validated.key);

  const next = [
    ...current.filter((variable) => variable.key !== validated.key),
    {
      key: validated.key,
      value: validated.value,
      secret: args.secret,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  ].sort((left, right) => left.key.localeCompare(right.key));

  if (next.length > MAX_STORED_ENVIRONMENT_VARIABLES) {
    throw new Error(
      `You can store at most ${MAX_STORED_ENVIRONMENT_VARIABLES} environment variables.`
    );
  }

  await redis.set(userEnvironmentKey(args.userId), next);
  return next;
}

export async function deleteUserEnvironmentVariable(args: {
  userId: string;
  key: string;
}): Promise<UserEnvironmentVariable[]> {
  return deleteUserEnvironmentVariableInRedis(getRedis(), args);
}

export async function deleteUserEnvironmentVariableInRedis(
  redis: UserEnvironmentRedis,
  args: {
    userId: string;
    key: string;
  }
): Promise<UserEnvironmentVariable[]> {
  const key = normalizeEnvironmentKey(args.key);
  if (!key) {
    throw new Error("Environment variable key is required.");
  }

  const current = await listUserEnvironmentVariablesInRedis(redis, args.userId);
  const next = current.filter((variable) => variable.key !== key);
  await redis.set(userEnvironmentKey(args.userId), next);
  return next;
}
