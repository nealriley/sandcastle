import assert from "node:assert/strict";
import test from "node:test";
import {
  enforcePairingGenerationLimitForRedis,
  enforcePairingRedemptionLimitsForRedis,
  enforceSessionCreateLimitsForRedis,
  RateLimitError,
} from "../lib/rate-limit.js";
import { FakeRedis } from "./helpers/fake-redis.js";

const fakeRedis = new FakeRedis();
const ORIGINAL_DATE_NOW = Date.now;

test.afterEach(() => {
  fakeRedis.reset();
  Date.now = ORIGINAL_DATE_NOW;
});

test("pairing generation limit allows a few new codes and then blocks refresh churn", async () => {
  Date.now = () => 1_000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await enforcePairingGenerationLimitForRedis(fakeRedis, "user_123");
  }

  await assert.rejects(
    () => enforcePairingGenerationLimitForRedis(fakeRedis, "user_123"),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.message.includes("Too many new connector codes")
  );
});

test("pairing redemption limit applies both globally and per code", async () => {
  Date.now = () => 5_000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await enforcePairingRedemptionLimitsForRedis(
      fakeRedis,
      "alpha beta gamma"
    );
  }

  await assert.rejects(
    () =>
      enforcePairingRedemptionLimitsForRedis(
        fakeRedis,
        "alpha beta gamma"
      ),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.message.includes("three-word connector code")
  );
});

test("session creation limits enforce both the global and per-user windows", async () => {
  Date.now = () => 10_000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await enforceSessionCreateLimitsForRedis(fakeRedis, "user_123");
  }

  await assert.rejects(
    () => enforceSessionCreateLimitsForRedis(fakeRedis, "user_123"),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.message.includes("for this account")
  );
});

test("fixed windows reset after enough time passes", async () => {
  Date.now = () => 20_000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await enforcePairingGenerationLimitForRedis(fakeRedis, "user_456");
  }

  await assert.rejects(
    () => enforcePairingGenerationLimitForRedis(fakeRedis, "user_456"),
    RateLimitError
  );

  Date.now = () => 20_000 + 11 * 60 * 1_000;
  await assert.doesNotReject(() =>
    enforcePairingGenerationLimitForRedis(fakeRedis, "user_456")
  );
});
