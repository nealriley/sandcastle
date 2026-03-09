import type {
  OwnedSandboxStatus,
  SessionOwnershipRecord,
  SessionToken,
  TaskStatus,
} from "./types.js";
import type { ExecutionStrategy } from "./template-service-types";
import { getRedis } from "./redis";

type SessionOwnershipRedis = {
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get<T>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: { ex?: number }
  ): Promise<unknown>;
  zadd(
    key: string,
    input: { score: number; member: string }
  ): Promise<unknown>;
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<unknown[]>;
};

const OWNERSHIP_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LISTED_SESSIONS = 100;

function sessionKeyKey(sessionKey: string): string {
  return `session:${sessionKey}`;
}

function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

function userSandboxKey(userId: string, sandboxId: string): string {
  return `user_sandbox:${userId}:${sandboxId}`;
}

export async function touchOwnedSession(args: {
  session: SessionToken;
  updatedAt: number;
  latestPrompt: string | null;
  status: OwnedSandboxStatus;
  templateSlug?: string | null;
  templateName?: string | null;
  executionStrategyKind?: ExecutionStrategy["kind"];
  envKeys?: string[];
}): Promise<SessionOwnershipRecord> {
  return touchOwnedSessionInRedis(getRedis(), args);
}

export async function touchOwnedSessionInRedis(
  redis: SessionOwnershipRedis,
  args: {
    session: SessionToken;
    updatedAt: number;
    latestPrompt: string | null;
    status: OwnedSandboxStatus;
    templateSlug?: string | null;
    templateName?: string | null;
    executionStrategyKind?: ExecutionStrategy["kind"];
    envKeys?: string[];
  }
): Promise<SessionOwnershipRecord> {
  const existing = await redis.get<SessionOwnershipRecord>(
    sessionKeyKey(args.session.sessionKey)
  );

  const record: SessionOwnershipRecord = {
    sessionKey: args.session.sessionKey,
    ownerUserId: args.session.ownerUserId,
    ownerLogin: args.session.ownerLogin,
    sandboxId: args.session.sandboxId,
    templateSlug: args.templateSlug ?? existing?.templateSlug ?? null,
    templateName: args.templateName ?? existing?.templateName ?? null,
    executionStrategyKind:
      args.executionStrategyKind ??
      existing?.executionStrategyKind ??
      "claude-agent",
    envKeys: args.envKeys ?? existing?.envKeys ?? [],
    runtime: args.session.runtime,
    ports: args.session.ports,
    createdAt: existing?.createdAt ?? args.session.createdAt,
    updatedAt: args.updatedAt,
    latestViewToken: args.session.viewToken,
    latestPrompt: args.latestPrompt ?? existing?.latestPrompt ?? null,
    status: args.status,
  };

  await redis.set(sessionKeyKey(args.session.sessionKey), record, {
    ex: OWNERSHIP_TTL_SECONDS,
  });
  await redis.zadd(userSessionsKey(args.session.ownerUserId), {
    score: record.updatedAt,
    member: args.session.sessionKey,
  });
  await redis.set(
    userSandboxKey(args.session.ownerUserId, args.session.sandboxId),
    args.session.sessionKey,
    { ex: OWNERSHIP_TTL_SECONDS }
  );
  await redis.expire(userSessionsKey(args.session.ownerUserId), OWNERSHIP_TTL_SECONDS);

  return record;
}

export async function getOwnedSession(
  sessionKey: string
): Promise<SessionOwnershipRecord | null> {
  return getOwnedSessionInRedis(getRedis(), sessionKey);
}

export async function getOwnedSessionInRedis(
  redis: SessionOwnershipRedis,
  sessionKey: string
): Promise<SessionOwnershipRecord | null> {
  return redis.get<SessionOwnershipRecord>(sessionKeyKey(sessionKey));
}

export async function listOwnedSessions(
  userId: string
): Promise<SessionOwnershipRecord[]> {
  return listOwnedSessionsInRedis(getRedis(), userId);
}

export async function listOwnedSessionsInRedis(
  redis: SessionOwnershipRedis,
  userId: string
): Promise<SessionOwnershipRecord[]> {
  const sessionKeys =
    ((await redis.zrange(
      userSessionsKey(userId),
      0,
      MAX_LISTED_SESSIONS - 1,
      { rev: true }
    )) as string[] | null) ?? [];

  if (sessionKeys.length === 0) {
    return [];
  }

  const records = await Promise.all(
    sessionKeys.map((sessionKey: string) =>
      redis.get<SessionOwnershipRecord>(sessionKeyKey(sessionKey))
    )
  );

  return records.filter(
    (record: SessionOwnershipRecord | null): record is SessionOwnershipRecord =>
      record != null && record.ownerUserId === userId
  );
}

export async function findOwnedSessionBySandboxId(
  userId: string,
  sandboxId: string
): Promise<SessionOwnershipRecord | null> {
  return findOwnedSessionBySandboxIdInRedis(getRedis(), userId, sandboxId);
}

export async function findOwnedSessionBySandboxIdInRedis(
  redis: SessionOwnershipRedis,
  userId: string,
  sandboxId: string
): Promise<SessionOwnershipRecord | null> {
  const indexedSessionKey = await redis.get<string>(userSandboxKey(userId, sandboxId));
  if (indexedSessionKey) {
    const indexedRecord = await redis.get<SessionOwnershipRecord>(
      sessionKeyKey(indexedSessionKey)
    );
    if (
      indexedRecord &&
      indexedRecord.ownerUserId === userId &&
      indexedRecord.sandboxId === sandboxId
    ) {
      return indexedRecord;
    }

    await redis.del(userSandboxKey(userId, sandboxId));
  }

  const records = await listOwnedSessionsInRedis(redis, userId);
  const match = records.find((record) => record.sandboxId === sandboxId) ?? null;
  if (match) {
    await redis.set(userSandboxKey(userId, sandboxId), match.sessionKey, {
      ex: OWNERSHIP_TTL_SECONDS,
    });
  }

  return match;
}

export function ownedSessionStatus(
  stopped: boolean,
  current: TaskStatus
): OwnedSandboxStatus {
  return stopped || current === "stopped" ? "stopped" : "active";
}
