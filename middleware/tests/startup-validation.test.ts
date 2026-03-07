import assert from "node:assert/strict";
import test from "node:test";
import { collectStartupValidationReport } from "../lib/startup-validation.js";

const ORIGINAL_AGENT_API_KEY = process.env.AGENT_API_KEY;
const ORIGINAL_TEMPLATE_SERVICE_INTERNAL_KEY =
  process.env.TEMPLATE_SERVICE_INTERNAL_KEY;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_CONTROL_TOKEN_SECRET = process.env.CONTROL_TOKEN_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
const ORIGINAL_AUTH_GITHUB_ID = process.env.AUTH_GITHUB_ID;
const ORIGINAL_AUTH_GITHUB_SECRET = process.env.AUTH_GITHUB_SECRET;
const ORIGINAL_KV_URL = process.env.KV_URL;
const ORIGINAL_KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const ORIGINAL_BASE_SNAPSHOT_ID = process.env.BASE_SNAPSHOT_ID;

test.afterEach(() => {
  process.env.AGENT_API_KEY = ORIGINAL_AGENT_API_KEY;
  process.env.TEMPLATE_SERVICE_INTERNAL_KEY =
    ORIGINAL_TEMPLATE_SERVICE_INTERNAL_KEY;
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  process.env.CONTROL_TOKEN_SECRET = ORIGINAL_CONTROL_TOKEN_SECRET;
  process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  process.env.AUTH_GITHUB_ID = ORIGINAL_AUTH_GITHUB_ID;
  process.env.AUTH_GITHUB_SECRET = ORIGINAL_AUTH_GITHUB_SECRET;
  process.env.KV_URL = ORIGINAL_KV_URL;
  process.env.KV_REST_API_TOKEN = ORIGINAL_KV_REST_API_TOKEN;
  process.env.BASE_SNAPSHOT_ID = ORIGINAL_BASE_SNAPSHOT_ID;
});

test("startup validation reports success when required Sandcastle config is present", () => {
  process.env.AGENT_API_KEY = "agent-key";
  process.env.TEMPLATE_SERVICE_INTERNAL_KEY = "template-service-key";
  process.env.ANTHROPIC_API_KEY = "anthropic-key";
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  process.env.AUTH_SECRET = "auth-secret";
  process.env.AUTH_GITHUB_ID = "github-id";
  process.env.AUTH_GITHUB_SECRET = "github-secret";
  process.env.KV_URL = "https://redis.example.test";
  process.env.KV_REST_API_TOKEN = "redis-token";
  process.env.BASE_SNAPSHOT_ID = "snap_123";

  const report = collectStartupValidationReport();
  assert.equal(report.status, "ok");
  assert.ok(report.checks.every((check) => check.status !== "error"));
});

test("startup validation reports config errors and snapshot warnings clearly", () => {
  delete process.env.AGENT_API_KEY;
  delete process.env.TEMPLATE_SERVICE_INTERNAL_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CONTROL_TOKEN_SECRET;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GITHUB_ID;
  delete process.env.AUTH_GITHUB_SECRET;
  delete process.env.KV_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.BASE_SNAPSHOT_ID;

  const report = collectStartupValidationReport();
  assert.equal(report.status, "error");
  assert.ok(
    report.checks.some(
      (check) => check.name === "website_auth" && check.status === "error"
    )
  );
  assert.ok(
    report.checks.some(
      (check) =>
        check.name === "template_service_auth" && check.status === "error"
    )
  );
  assert.ok(
    report.checks.some(
      (check) => check.name === "template_snapshot_warning" && check.status === "warn"
    )
  );
});
