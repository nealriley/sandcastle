import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSessionViewAccess } from "../lib/session-view-access.js";

test("evaluateSessionViewAccess requires sign-in before allowing access", () => {
  assert.deepEqual(
    evaluateSessionViewAccess({
      viewerUserId: null,
      tokenOwnerUserId: "user_123",
      recordOwnerUserId: null,
    }),
    {
      kind: "unauthenticated",
      ownerUserId: "user_123",
    }
  );
});

test("evaluateSessionViewAccess forbids a different signed-in user", () => {
  assert.deepEqual(
    evaluateSessionViewAccess({
      viewerUserId: "user_456",
      tokenOwnerUserId: "user_123",
      recordOwnerUserId: "user_123",
    }),
    {
      kind: "forbidden",
      ownerUserId: "user_123",
    }
  );
});

test("evaluateSessionViewAccess prefers the ownership record when present", () => {
  assert.deepEqual(
    evaluateSessionViewAccess({
      viewerUserId: "user_789",
      tokenOwnerUserId: "stale_user",
      recordOwnerUserId: "user_789",
    }),
    {
      kind: "allowed",
      ownerUserId: "user_789",
    }
  );
});
