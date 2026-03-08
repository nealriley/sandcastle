import assert from "node:assert/strict";
import test from "node:test";
import {
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
