import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOwnedSandboxTask } from "../lib/create-owned-sandbox.ts";
import { getOrCreatePairingCode } from "../lib/pairing.ts";
import {
  getCreatableSandcastleTemplate,
} from "../lib/templates.ts";
import type {
  SandboxListResponse,
  TaskResponse,
} from "../lib/types.js";

const BASE_URL = (
  process.env.SANDCASTLE_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  "https://middleware-psi-five.vercel.app"
).replace(/\/$/, "");
const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";
const KEEP_SANDBOXES = process.env.SANDCASTLE_SMOKE_KEEP_SANDBOXES === "1";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

type ManagedSandbox = {
  label: string;
  sandboxId: string;
  sessionId: string;
};

function requireEnv(name: string, value: string) {
  if (!value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON from ${response.url}, received: ${text.slice(0, 400)}`
    );
  }
}

async function postJson<T>(path: string, init: {
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  expectedStatuses: number[];
}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body),
  });
  const payload = (await readJson(response)) as T;

  if (!init.expectedStatuses.includes(response.status)) {
    throw new Error(
      `POST ${path} returned ${response.status}: ${JSON.stringify(payload, null, 2)}`
    );
  }

  return payload;
}

async function getJson<T>(path: string, expectedStatuses: number[]): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Cache-Control": "no-store" },
  });
  const payload = (await readJson(response)) as T;

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `GET ${path} returned ${response.status}: ${JSON.stringify(payload, null, 2)}`
    );
  }

  return payload;
}

async function pollTask(label: string, taskId: string): Promise<TaskResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const status = await getJson<TaskResponse>(
      `/api/tasks/${encodeURIComponent(taskId)}?_t=${Date.now()}`,
      [200, 404]
    );
    console.log(
      `   ${label}: ${status.status} (${status.phase}) ${status.phaseDetail ?? ""}`.trim()
    );

    if (
      status.status === "complete" ||
      status.status === "failed" ||
      status.status === "stopped"
    ) {
      return status;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${label} after ${POLL_TIMEOUT_MS}ms.`);
}

async function stopManagedSandboxes(managed: ManagedSandbox[]) {
  if (KEEP_SANDBOXES || managed.length === 0) {
    return;
  }

  for (const sandbox of managed.reverse()) {
    try {
      const response = await fetch(
        `${BASE_URL}/api/sessions/${encodeURIComponent(sandbox.sessionId)}/stop`,
        { method: "POST" }
      );
      if (!response.ok) {
        const payload = await readJson(response);
        console.warn(
          `Failed to stop ${sandbox.label} (${sandbox.sandboxId}): ${response.status}`,
          payload
        );
      } else {
        console.log(`   Stopped ${sandbox.label} (${sandbox.sandboxId})`);
      }
    } catch (error) {
      console.warn(`Failed to stop ${sandbox.label} (${sandbox.sandboxId})`, error);
    }
  }
}

async function main() {
  requireEnv("AGENT_API_KEY", AGENT_API_KEY);
  requireEnv("CONTROL_TOKEN_SECRET", process.env.CONTROL_TOKEN_SECRET ?? "");
  requireEnv(
    "UPSTASH_REDIS_REST_URL or KV_URL/REDIS_URL",
    firstNonEmpty(
      process.env.UPSTASH_REDIS_REST_URL,
      process.env.KV_REST_API_URL,
      process.env.KV_URL,
      process.env.REDIS_URL
    )
  );
  requireEnv(
    "UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN",
    firstNonEmpty(
      process.env.UPSTASH_REDIS_REST_TOKEN,
      process.env.KV_REST_API_TOKEN
    )
  );
  requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY ?? "");
  console.log("=== Sandcastle E2E Smoke Test ===\n");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Keep sandboxes: ${KEEP_SANDBOXES ? "yes" : "no"}\n`);
  const includeCodex =
    (process.env.OPENAI_API_KEY ?? "").trim().length > 0 &&
    process.env.SANDCASTLE_SMOKE_SKIP_CODEX !== "1";

  const suffix = randomUUID().slice(0, 8);
  const user = {
    id: `sandcastle-smoke-${suffix}`,
    login: `sandcastle-smoke-${suffix}`,
  };
  const managed: ManagedSandbox[] = [];
  let codexStart: TaskResponse | null = null;

  try {
    console.log("1. Minting connector code and listing owned sandboxes...");
    const firstCode = (await getOrCreatePairingCode(user)).code;
    const initialList = await postJson<SandboxListResponse>("/api/sandboxes", {
      body: { authCode: firstCode, includeStopped: true },
      expectedStatuses: [200],
    });
    assert.equal(initialList.errorCode, null);
    assert.equal(initialList.sandboxes.length, 0);
    console.log("   PASS: Fresh paired user has no owned sandboxes.");

    console.log(
      "\n2. Starting a Claude Code sandbox through the Pack-compatible control-plane route..."
    );
    const claudeStart = await postJson<TaskResponse>("/api/sessions", {
      headers: { "X-Agent-Key": AGENT_API_KEY },
      body: {
        prompt:
          "Create a file named smoke-http.txt containing the exact text 'sandcastle smoke test', then read it back and report the contents.",
        authCode: firstCode,
        templateSlug: "claude-code",
      },
      expectedStatuses: [202],
    });
    managed.push({
      label: "claude sandbox",
      sandboxId: claudeStart.sandboxId,
      sessionId: claudeStart.sessionId,
    });
    const claudeDone = await pollTask("claude sandbox", claudeStart.taskId);
    assert.equal(claudeDone.status, "complete");
    assert.match(claudeDone.result ?? "", /sandcastle smoke test/i);
    managed[managed.length - 1].sessionId = claudeDone.sessionId;
    console.log("   PASS: Claude Code sandbox completed the initial task.");

    if (includeCodex) {
      console.log(
        "\n3. Starting a Codex sandbox through the Pack-compatible control-plane route..."
      );
      codexStart = await postJson<TaskResponse>("/api/sessions", {
        headers: { "X-Agent-Key": AGENT_API_KEY },
        body: {
          prompt:
            "Create a file named smoke-codex.txt containing the exact text 'codex smoke test', then read it back and report the contents.",
          authCode: firstCode,
          templateSlug: "codex",
        },
        expectedStatuses: [202],
      });
      managed.push({
        label: "codex sandbox",
        sandboxId: codexStart.sandboxId,
        sessionId: codexStart.sessionId,
      });
      const codexDone = await pollTask("codex sandbox", codexStart.taskId);
      assert.equal(codexDone.status, "complete");
      assert.match(codexDone.result ?? "", /codex smoke test/i);
      managed[managed.length - 1].sessionId = codexDone.sessionId;
      console.log("   PASS: Codex sandbox completed the initial task.");
    } else {
      console.log(
        "\n3. Skipping Codex smoke because OPENAI_API_KEY is not configured locally or SANDCASTLE_SMOKE_SKIP_CODEX=1."
      );
    }

    console.log(
      "\n4. Starting a wordcount shell-command sandbox through the shared creation path..."
    );
    const template = getCreatableSandcastleTemplate("wordcount");
    assert.ok(template, "Expected wordcount template to exist");
    const baseRequest = new Request(`${BASE_URL}/smoke/e2e`);
    const wordcountStart = await createOwnedSandboxTask(baseRequest as never, {
      prompt: "/vercel/sandbox/wordcount.txt",
      runtime: "node24",
      template,
      environment: {
        WORDCOUNT_METHOD: "awk-fields",
      },
      envKeys: ["WORDCOUNT_METHOD"],
      ownerUserId: user.id,
      ownerLogin: user.login,
    });
    managed.push({
      label: "wordcount sandbox",
      sandboxId: wordcountStart.sandboxId,
      sessionId: wordcountStart.sessionId,
    });
    const wordcountDone = await pollTask(
      "wordcount sandbox",
      wordcountStart.taskId
    );
    assert.equal(wordcountDone.status, "complete");
    assert.match(wordcountDone.result ?? "", /Method:\s*awk-fields/i);
    assert.match(
      wordcountDone.result ?? "",
      /File:\s*\/vercel\/sandbox\/wordcount\.txt/i
    );
    assert.match(wordcountDone.result ?? "", /Word count:\s*4/i);
    managed[managed.length - 1].sessionId = wordcountDone.sessionId;
    console.log(
      "   PASS: Wordcount shell-command sandbox completed successfully."
    );

    console.log(
      "\n5. Continuing the Claude Code sandbox with the token-scoped follow-up route..."
    );
    const claudeFollowUp = await postJson<TaskResponse>(
      `/api/sessions/${encodeURIComponent(claudeDone.sessionId)}/prompt`,
      {
        body: {
          prompt:
            "Read smoke-http.txt again and confirm it still contains the exact text sandcastle smoke test.",
        },
        expectedStatuses: [202],
      }
    );
    const claudeFollowUpDone = await pollTask(
      "claude follow-up",
      claudeFollowUp.taskId
    );
    assert.equal(claudeFollowUpDone.status, "complete");
    assert.match(claudeFollowUpDone.result ?? "", /sandcastle smoke test/i);
    managed[0].sessionId = claudeFollowUpDone.sessionId;
    console.log("   PASS: Token-scoped follow-up succeeded.");

    console.log("\n6. Listing owned sandboxes again and checking template metadata...");
    const secondCode = (await getOrCreatePairingCode(user)).code;
    const listed = await postJson<SandboxListResponse>("/api/sandboxes", {
      body: { authCode: secondCode, includeStopped: true },
      expectedStatuses: [200],
    });
    assert.ok(
      listed.sandboxes.some((sandbox) => sandbox.sandboxId === claudeStart.sandboxId)
    );
    if (codexStart) {
      assert.ok(
        listed.sandboxes.some(
          (sandbox) =>
            sandbox.sandboxId === codexStart!.sandboxId &&
            sandbox.templateSlug === "codex"
        )
      );
    }
    assert.ok(
      listed.sandboxes.some(
        (sandbox) =>
          sandbox.sandboxId === wordcountStart.sandboxId &&
          sandbox.templateSlug === "wordcount"
      )
    );
    console.log("   PASS: Owned sandbox discovery returned all smoke sandboxes.");

    console.log("\n7. Verifying shell-command sandboxes reject follow-up prompts...");
    const resumed = await postJson<{ error?: string }>("/api/sandboxes/resume", {
      body: {
        authCode: secondCode,
        sandboxId: wordcountStart.sandboxId,
        prompt: "Run another command.",
      },
      expectedStatuses: [400],
    });
    assert.match(resumed.error ?? "", /does not accept follow-up prompts/i);
    console.log("   PASS: Shell-command follow-up rejection is enforced.");

    console.log("\n=== Sandcastle E2E smoke test passed ===");
  } finally {
    console.log("\n8. Cleaning up smoke sandboxes...");
    await stopManagedSandboxes(managed);
  }
}

main().catch((error) => {
  console.error("\n=== Sandcastle E2E smoke test failed ===");
  console.error(error);
  process.exit(1);
});
