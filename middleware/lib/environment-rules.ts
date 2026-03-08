export const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MAX_ENV_VALUE_LENGTH = 4_000;

export const BLOCKED_ENV_KEYS = new Set([
  "AGENT_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "AUTH_SECRET",
  "CONTROL_TOKEN_SECRET",
  "HOME",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "SHELL",
  "USER",
]);

export const ALLOWED_PROVIDER_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
]);

export const BLOCKED_ENV_PREFIXES = [
  "ANTHROPIC_",
  "AUTH_",
  "CODA_",
  "CONTROL_",
  "KV_",
  "NEXTAUTH_",
  "NEXT_PUBLIC_",
  "REDIS_",
  "UPSTASH_",
  "VERCEL_",
];

export interface EnvironmentEntryInput {
  key?: string;
  value?: string;
}

export function normalizeEnvironmentKey(input: string): string {
  return input.trim().toUpperCase();
}

export function isBlockedEnvironmentKey(key: string): boolean {
  if (ALLOWED_PROVIDER_ENV_KEYS.has(key)) {
    return false;
  }

  if (BLOCKED_ENV_KEYS.has(key)) {
    return true;
  }

  return BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function validateEnvironmentEntry(
  entry: EnvironmentEntryInput
): { key: string; value: string } {
  const rawKey = typeof entry.key === "string" ? entry.key : "";
  const rawValue = typeof entry.value === "string" ? entry.value : "";
  const key = normalizeEnvironmentKey(rawKey);

  if (!key) {
    throw new Error("Environment variable keys cannot be blank.");
  }

  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error(
      `Environment variable '${key}' must start with a letter and contain only A-Z, 0-9, and underscores.`
    );
  }

  if (isBlockedEnvironmentKey(key)) {
    throw new Error(
      `Environment variable '${key}' is reserved by Sandcastle and cannot be set on a sandbox.`
    );
  }

  if (rawValue.length > MAX_ENV_VALUE_LENGTH) {
    throw new Error(
      `Environment variable '${key}' exceeds the maximum value length of ${MAX_ENV_VALUE_LENGTH} characters.`
    );
  }

  return {
    key,
    value: rawValue,
  };
}
