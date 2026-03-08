import type { Sandbox } from "@vercel/sandbox";
import {
  validateEnvironmentEntry,
} from "./environment-rules";
const MAX_ENVIRONMENT_VARIABLES = 16;
export const SANDBOX_ENV_PATH = "/vercel/sandbox/.sandcastle-env.json";

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

    const validated = validateEnvironmentEntry({
      key: rawKey,
      value: rawValue,
    });

    if (env.has(validated.key)) {
      throw new Error(
        `Environment variable '${validated.key}' is defined more than once.`
      );
    }

    env.set(validated.key, validated.value);
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
