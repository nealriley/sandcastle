import assert from "node:assert/strict";
import test from "node:test";
import { readAgentResult, selectFinalAgentResult } from "../lib/agent-runner.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

test("selectFinalAgentResult prefers the explicit SDK result over streamed or assistant text", () => {
  const selected = selectFinalAgentResult({
    sdkResult: "Final SDK result",
    responseText: "Streamed response text",
    assistantText: "Assistant block text",
    errorText: null,
    agentSessionId: "agent_123",
  });

  assert.deepEqual(selected, {
    result: "Final SDK result",
    agentSessionId: "agent_123",
    source: "sdk_result",
  });
});

test("selectFinalAgentResult prefers the accumulated response stream when no SDK result is available", () => {
  const selected = selectFinalAgentResult({
    sdkResult: null,
    responseText: "First part\nSecond part\n",
    assistantText: "Short assistant fallback",
    errorText: null,
    agentSessionId: "agent_456",
  });

  assert.deepEqual(selected, {
    result: "First part\nSecond part",
    agentSessionId: "agent_456",
    source: "response_stream",
  });
});

test("selectFinalAgentResult turns task errors into deterministic error results", () => {
  const selected = selectFinalAgentResult({
    sdkResult: "Should not win",
    responseText: "Should not win either",
    assistantText: "Also ignored",
    errorText: "Runner timed out",
    agentSessionId: "agent_789",
  });

  assert.deepEqual(selected, {
    result: "Error: Runner timed out",
    agentSessionId: "agent_789",
    source: "error",
  });
});

test("readAgentResult infers a fallback source for legacy result payloads", async () => {
  const sandbox = new FakeSandbox();
  sandbox.setFile(
    "/vercel/sandbox/.result-file_123.json",
    JSON.stringify({
      result: "Legacy assistant text",
      agentSessionId: "agent_legacy",
    })
  );

  const result = await readAgentResult(sandbox as never, "file_123");

  assert.deepEqual(result, {
    result: "Legacy assistant text",
    agentSessionId: "agent_legacy",
    source: "assistant_blocks",
  });
});
