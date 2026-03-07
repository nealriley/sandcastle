import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReadableSandboxPath,
  statusCodeForFileReadError,
} from "../lib/sandbox-file-access.js";

test("normalizeReadableSandboxPath keeps readable files inside /vercel/sandbox", () => {
  assert.equal(
    normalizeReadableSandboxPath("src/app/page.tsx"),
    "/vercel/sandbox/src/app/page.tsx"
  );
  assert.equal(
    normalizeReadableSandboxPath("/vercel/sandbox/README.md"),
    "/vercel/sandbox/README.md"
  );
});

test("normalizeReadableSandboxPath rejects traversal and reserved internal files", () => {
  assert.throws(
    () => normalizeReadableSandboxPath("../etc/passwd"),
    /must stay inside \/vercel\/sandbox/i
  );
  assert.throws(
    () => normalizeReadableSandboxPath(".sandcastle-env.json"),
    /reserved for internal session state/i
  );
  assert.throws(
    () => normalizeReadableSandboxPath(".log-task.jsonl"),
    /reserved for internal session state/i
  );
});

test("statusCodeForFileReadError maps path violations to forbidden responses", () => {
  assert.equal(
    statusCodeForFileReadError(
      "That file is reserved for internal session state and cannot be read via ReadFile."
    ),
    403
  );
  assert.equal(
    statusCodeForFileReadError("Path must stay inside /vercel/sandbox."),
    403
  );
});
