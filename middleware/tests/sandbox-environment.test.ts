import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSandboxEnvironment,
  SANDBOX_ENV_PATH,
  writeSandboxEnvironmentFile,
} from "../lib/sandbox-environment.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

test("normalizeSandboxEnvironment accepts valid uppercase keys and sorts them", () => {
  const result = normalizeSandboxEnvironment([
    { key: "second_key", value: "two" },
    { key: "FIRST_KEY", value: "one" },
  ]);

  assert.deepEqual(result, {
    env: {
      FIRST_KEY: "one",
      SECOND_KEY: "two",
    },
    envKeys: ["FIRST_KEY", "SECOND_KEY"],
  });
});

test("normalizeSandboxEnvironment rejects reserved Sandcastle keys but allows provider overrides", () => {
  assert.throws(
    () =>
      normalizeSandboxEnvironment([
        { key: "AUTH_SECRET", value: "secret" },
      ]),
    /reserved by Sandcastle/
  );

  const allowed = normalizeSandboxEnvironment([
    { key: "ANTHROPIC_API_KEY", value: "anthropic-secret" },
    { key: "ANTHROPIC_MODEL", value: "claude-sonnet-4-5" },
    { key: "OPENAI_API_KEY", value: "openai-secret" },
  ]);

  assert.deepEqual(allowed, {
    env: {
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
      OPENAI_API_KEY: "openai-secret",
    },
    envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENAI_API_KEY"],
  });
});

test("normalizeSandboxEnvironment ignores empty rows and rejects duplicates", () => {
  const emptyRows = normalizeSandboxEnvironment([
    { key: "", value: "" },
    { key: " API_TOKEN ", value: "" },
  ]);
  assert.deepEqual(emptyRows, {
    env: { API_TOKEN: "" },
    envKeys: ["API_TOKEN"],
  });

  assert.throws(
    () =>
      normalizeSandboxEnvironment([
        { key: "API_TOKEN", value: "one" },
        { key: "api_token", value: "two" },
      ]),
    /defined more than once/
  );
});

test("writeSandboxEnvironmentFile persists the raw env bundle inside the sandbox", async () => {
  const sandbox = new FakeSandbox();
  await writeSandboxEnvironmentFile(sandbox as never, {
    SALABLE_API_KEY: "secret-value",
    OTHER_KEY: "second",
  });

  const file = await sandbox.readFileToBuffer({ path: SANDBOX_ENV_PATH });
  assert.ok(file);
  assert.deepEqual(JSON.parse(file.toString("utf-8")), {
    SALABLE_API_KEY: "secret-value",
    OTHER_KEY: "second",
  });
});
