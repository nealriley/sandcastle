import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpFollowUpPresentation,
  buildMcpLaunchPresentation,
  buildMcpSandboxPresentation,
} from "../lib/mcp-presentation.js";

test("launch presentation promotes the Sandcastle follow-along URL", () => {
  const task = {
    sandboxId: "sbx_123",
    sandboxUrl: "https://sandcastle.example.com/sandboxes/view_123",
    previewUrl: "https://sbx_123.vercel.run",
    logsUrl: "https://sandcastle.example.com/sandboxes/view_123",
    sessionUrl: "https://sandcastle.example.com/sandboxes/view_123",
  };

  const presentation = buildMcpLaunchPresentation(task);

  assert.equal(
    presentation.payload.followAlongUrl,
    "https://sandcastle.example.com/sandboxes/view_123"
  );
  assert.match(
    presentation.summary,
    /Sandcastle follow-along URL: https:\/\/sandcastle\.example\.com\/sandboxes\/view_123/
  );
  assert.match(presentation.summary, /Do not turn sandboxId into a browser URL/);
});

test("sandbox presentation promotes the Sandcastle follow-along URL", () => {
  const sandbox = {
    sandboxId: "sbx_456",
    sandboxUrl: "https://sandcastle.example.com/sandboxes/view_456",
    previewUrl: null,
    status: "running" as const,
  };

  const presentation = buildMcpSandboxPresentation(sandbox);

  assert.equal(
    presentation.payload.followAlongUrl,
    "https://sandcastle.example.com/sandboxes/view_456"
  );
  assert.match(
    presentation.summary,
    /Sandcastle follow-along URL: https:\/\/sandcastle\.example\.com\/sandboxes\/view_456/
  );
  assert.match(presentation.summary, /Preview URL: not ready yet/);
});

test("follow-up presentation explains how to continue tracking the sandbox", () => {
  const task = {
    sandboxId: "sbx_789",
    sandboxUrl: "https://sandcastle.example.com/sandboxes/view_789",
    previewUrl: "https://sbx_789.vercel.run",
    logsUrl: "https://sandcastle.example.com/sandboxes/view_789",
    sessionUrl: "https://sandcastle.example.com/sandboxes/view_789",
  };

  const presentation = buildMcpFollowUpPresentation(task);

  assert.equal(
    presentation.payload.followAlongUrl,
    "https://sandcastle.example.com/sandboxes/view_789"
  );
  assert.match(presentation.summary, /Follow-up queued/);
  assert.match(
    presentation.summary,
    /Use sandcastle_get_sandbox to check task progress/
  );
});
