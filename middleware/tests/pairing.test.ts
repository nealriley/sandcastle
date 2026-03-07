import assert from "node:assert/strict";
import test from "node:test";
import { FakeRedis } from "./helpers/fake-redis.js";
import {
  getOrCreatePairingCodeForRedis,
  normalizePairingCode,
  readPairingCodeForRedis,
  redeemPairingCodeForRedis,
} from "../lib/pairing.js";

const fakeRedis = new FakeRedis();
const ORIGINAL_DATE_NOW = Date.now;

test.afterEach(() => {
  fakeRedis.reset();
  Date.now = ORIGINAL_DATE_NOW;
});

test("normalizePairingCode canonicalizes punctuation and spacing", () => {
  assert.equal(
    normalizePairingCode("  Apple,   BANANA---carrot "),
    "apple banana carrot"
  );
});

test("normalizePairingCode rejects anything other than exactly three words", () => {
  assert.throws(
    () => normalizePairingCode("alpha beta"),
    /exactly three words/
  );
  assert.throws(
    () => normalizePairingCode("alpha beta gamma delta"),
    /exactly three words/
  );
});

test("getOrCreatePairingCode reuses the active code for the same website user", async () => {
  Date.now = () => 50_000;
  const user = {
    id: "user_123",
    login: "jarvis",
    name: "Jarvis",
    email: "jarvis@example.com",
    image: null,
  };

  const first = await getOrCreatePairingCodeForRedis(fakeRedis, user);
  const second = await getOrCreatePairingCodeForRedis(fakeRedis, user);

  assert.equal(second.code, first.code);
  assert.equal(second.expiresAt, first.expiresAt);
  assert.match(first.code, /^[a-z]+ [a-z]+ [a-z]+$/);
  assert.ok(first.expiresAt > Date.now());
});

test("redeemPairingCode normalizes input, consumes the code, and clears the active user record", async () => {
  Date.now = () => 100_000;
  const user = {
    id: "user_456",
    login: "builder",
    name: "Builder",
    email: "builder@example.com",
    image: null,
  };

  const created = await getOrCreatePairingCodeForRedis(fakeRedis, user);
  const redeemed = await redeemPairingCodeForRedis(
    fakeRedis,
    created.code.toUpperCase().replace(/ /g, "--")
  );

  assert.deepEqual(redeemed, {
    userId: "user_456",
    userLogin: "builder",
    code: created.code,
  });

  const secondRedeem = await redeemPairingCodeForRedis(fakeRedis, created.code);
  assert.equal(secondRedeem, null);

  const replacement = await getOrCreatePairingCodeForRedis(fakeRedis, user);
  assert.notEqual(replacement.code, created.code);
});

test("redeemPairingCode rejects malformed or expired codes", async () => {
  Date.now = () => 200_000;
  const user = {
    id: "user_789",
    login: null,
    name: null,
    email: null,
    image: null,
  };

  const created = await getOrCreatePairingCodeForRedis(fakeRedis, user);
  Date.now = () => created.expiresAt + 1;

  assert.equal(await redeemPairingCodeForRedis(fakeRedis, "two words"), null);
  assert.equal(await redeemPairingCodeForRedis(fakeRedis, created.code), null);
});

test("readPairingCode previews a valid code without consuming it", async () => {
  Date.now = () => 300_000;
  const user = {
    id: "user_preview",
    login: "previewer",
    name: null,
    email: null,
    image: null,
  };

  const created = await getOrCreatePairingCodeForRedis(fakeRedis, user);
  const preview = await readPairingCodeForRedis(fakeRedis, created.code);
  const redeemed = await redeemPairingCodeForRedis(fakeRedis, created.code);

  assert.deepEqual(preview, {
    userId: "user_preview",
    userLogin: "previewer",
    code: created.code,
  });
  assert.deepEqual(redeemed, preview);
});
