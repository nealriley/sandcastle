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

test("normalizeSandboxEnvironment rejects reserved Sandcastle keys", () => {
  assert.throws(
    () =>
      normalizeSandboxEnvironment([
        { key: "ANTHROPIC_API_KEY", value: "secret" },
      ]),
    /reserved by Sandcastle/
  );
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
