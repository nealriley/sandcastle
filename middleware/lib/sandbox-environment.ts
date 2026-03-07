import type { Sandbox } from "@vercel/sandbox";

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_ENVIRONMENT_VARIABLES = 16;
const MAX_ENV_VALUE_LENGTH = 4_000;
export const SANDBOX_ENV_PATH = "/vercel/sandbox/.sandcastle-env.json";

const BLOCKED_ENV_KEYS = new Set([
  "AGENT_API_KEY",
  "ANTHROPIC_API_KEY",
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

const BLOCKED_ENV_PREFIXES = [
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

export interface SandboxEnvironmentEntryInput {
  key?: string;
  value?: string;
}

export interface NormalizedSandboxEnvironment {
  env: Record<string, string>;
  envKeys: string[];
}

function normalizeKey(input: string): string {
  return input.trim().toUpperCase();
}

function isBlockedKey(key: string): boolean {
  if (BLOCKED_ENV_KEYS.has(key)) {
    return true;
  }

  return BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function normalizeSandboxEnvironment(
  entries: SandboxEnvironmentEntryInput[] | undefined
): NormalizedSandboxEnvironment {
  if (!entries || entries.length === 0) {
    return { env: {}, envKeys: [] };
  }

  if (!Array.isArray(entries)) {
    throw new Error("Environment must be an array of key/value entries.");
  }

  const env = new Map<string, string>();

  for (const entry of entries) {
    const rawKey = typeof entry?.key === "string" ? entry.key : "";
    const rawValue = typeof entry?.value === "string" ? entry.value : "";
    const key = normalizeKey(rawKey);

    if (!key && rawValue.trim() === "") {
      continue;
    }

    if (!key) {
      throw new Error("Environment variable keys cannot be blank.");
    }

    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(
        `Environment variable '${key}' must start with a letter and contain only A-Z, 0-9, and underscores.`
      );
    }

    if (isBlockedKey(key)) {
      throw new Error(
        `Environment variable '${key}' is reserved by Sandcastle and cannot be set on a sandbox.`
      );
    }

    if (rawValue.length > MAX_ENV_VALUE_LENGTH) {
      throw new Error(
        `Environment variable '${key}' exceeds the maximum value length of ${MAX_ENV_VALUE_LENGTH} characters.`
      );
    }

    if (env.has(key)) {
      throw new Error(`Environment variable '${key}' is defined more than once.`);
    }

    env.set(key, rawValue);
  }

  if (env.size > MAX_ENVIRONMENT_VARIABLES) {
    throw new Error(
      `A sandbox can include at most ${MAX_ENVIRONMENT_VARIABLES} environment variables.`
    );
  }

  const envObject = Object.fromEntries([...env.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    env: envObject,
    envKeys: Object.keys(envObject),
  };
}

export async function writeSandboxEnvironmentFile(
  sandbox: Pick<Sandbox, "writeFiles">,
  environment: Record<string, string>
): Promise<void> {
  await sandbox.writeFiles([
    {
      path: SANDBOX_ENV_PATH,
      content: Buffer.from(JSON.stringify(environment)),
    },
  ]);
}
