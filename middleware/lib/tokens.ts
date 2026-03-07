import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AnthropicProxyToken,
  SessionToken,
  TaskToken,
  ViewToken,
} from "./types.js";

interface TokenEnvelope<T> {
  v: 1;
  iat: number;
  exp: number;
  data: T;
}

export class TokenConfigurationError extends Error {
  override name = "TokenConfigurationError";
}

const SESSION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const TASK_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const VIEW_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ANTHROPIC_PROXY_TOKEN_TTL_MS = 15 * 60 * 1000;

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | null {
  return values.find((candidate) => candidate && candidate.trim()) ?? null;
}

function requireTokenSecret(
  description: string,
  envNames: string[]
): string {
  const secret = firstNonEmpty(
    ...envNames.map((envName) => process.env[envName])
  );
  if (secret) {
    return secret;
  }

  throw new TokenConfigurationError(
    `Missing ${description}. Set ${envNames.join(" or ")}.`
  );
}

function getSessionTokenSecret(): string {
  return requireTokenSecret("session token signing secret", [
    "SESSION_TOKEN_SECRET",
    "CONTROL_TOKEN_SECRET",
    "VIEW_TOKEN_SECRET",
  ]);
}

function getTaskTokenSecret(): string {
  return requireTokenSecret("task token signing secret", [
    "TASK_TOKEN_SECRET",
    "CONTROL_TOKEN_SECRET",
    "VIEW_TOKEN_SECRET",
  ]);
}

function getViewTokenSecret(): string {
  return requireTokenSecret("view token signing secret", [
    "VIEW_TOKEN_SECRET",
    "CONTROL_TOKEN_SECRET",
  ]);
}

function getAnthropicProxyTokenSecret(): string {
  return requireTokenSecret("Anthropic proxy token signing secret", [
    "ANTHROPIC_PROXY_TOKEN_SECRET",
    "CONTROL_TOKEN_SECRET",
    "VIEW_TOKEN_SECRET",
  ]);
}

function toBase64Url(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function fromBase64Url<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as T;
}

function sign(
  prefix: string,
  payload: string,
  getSecret: () => string
): string {
  return createHmac("sha256", getSecret())
    .update(`${prefix}.${payload}`)
    .digest("base64url");
}

function encodeSignedToken<T>(
  prefix: string,
  data: T,
  ttlMs: number,
  getSecret: () => string
): string {
  const now = Date.now();
  const envelope: TokenEnvelope<T> = {
    v: 1,
    iat: now,
    exp: now + ttlMs,
    data,
  };
  const payload = toBase64Url(envelope);
  const signature = sign(prefix, payload, getSecret);
  return `${prefix}${payload}.${signature}`;
}

function decodeSignedToken<T>(
  token: string,
  prefix: string,
  getSecret: () => string
): T {
  if (!token.startsWith(prefix)) {
    throw new Error("Invalid token prefix");
  }

  const raw = token.slice(prefix.length);
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) {
    throw new Error("Invalid token format");
  }

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sign(prefix, payload, getSecret);

  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new Error("Invalid token signature");
  }

  const envelope = fromBase64Url<TokenEnvelope<T>>(payload);
  if (envelope.v !== 1) {
    throw new Error("Unsupported token version");
  }
  if (envelope.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return envelope.data;
}

export function encodeSessionToken(data: SessionToken): string {
  return encodeSignedToken("ses_", data, SESSION_TOKEN_TTL_MS, getSessionTokenSecret);
}

export function decodeSessionToken(token: string): SessionToken {
  return decodeSignedToken<SessionToken>(token, "ses_", getSessionTokenSecret);
}

export function encodeTaskToken(data: TaskToken): string {
  return encodeSignedToken("tsk_", data, TASK_TOKEN_TTL_MS, getTaskTokenSecret);
}

export function decodeTaskToken(token: string): TaskToken {
  return decodeSignedToken<TaskToken>(token, "tsk_", getTaskTokenSecret);
}

export function encodeViewToken(data: ViewToken): string {
  return encodeSignedToken("view_", data, VIEW_TOKEN_TTL_MS, getViewTokenSecret);
}

export function decodeViewToken(token: string): ViewToken {
  return decodeSignedToken<ViewToken>(token, "view_", getViewTokenSecret);
}

export function encodeAnthropicProxyToken(data: AnthropicProxyToken): string {
  return encodeSignedToken(
    "atp_",
    data,
    ANTHROPIC_PROXY_TOKEN_TTL_MS,
    getAnthropicProxyTokenSecret
  );
}

export function decodeAnthropicProxyToken(token: string): AnthropicProxyToken {
  return decodeSignedToken<AnthropicProxyToken>(
    token,
    "atp_",
    getAnthropicProxyTokenSecret
  );
}

export function isTokenConfigurationError(
  error: unknown
): error is TokenConfigurationError {
  return (
    error instanceof TokenConfigurationError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === TokenConfigurationError.name)
  );
}

export function assertSessionStartTokenConfiguration(): void {
  getSessionTokenSecret();
  getTaskTokenSecret();
  getViewTokenSecret();
  getAnthropicProxyTokenSecret();
}

export function assertFollowUpTokenConfiguration(): void {
  getSessionTokenSecret();
  getTaskTokenSecret();
  getAnthropicProxyTokenSecret();
}
