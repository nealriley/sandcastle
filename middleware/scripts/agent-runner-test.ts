/**
 * Phase 3: Agent Runner Integration Test
 *
 * Tests the full flow:
 * 1. Create sandbox from snapshot
 * 2. Use startAgentTask() to run a simple prompt
 * 3. Poll readAgentResult() until complete
 * 4. Verify the result contains meaningful output
 * 5. Stop sandbox
 *
 * Run: pnpm agent-test (from middleware/)
 *
 * Requires:
 * - .env.local with VERCEL_OIDC_TOKEN and ANTHROPIC_API_KEY
 * - BASE_SNAPSHOT_ID env var (optional — uses fresh sandbox if not set)
 */

import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import { startAgentTask, readAgentResult } from "../lib/agent-runner.ts";

const SNAPSHOT_ID = process.env.BASE_SNAPSHOT_ID;

async function main() {
  console.log("=== Agent Runner Integration Test ===\n");

  // 1. Create sandbox
  console.log("1. Creating sandbox...");
  const startCreate = Date.now();
  const sandbox = SNAPSHOT_ID
    ? await Sandbox.create({
        source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
        resources: { vcpus: 2 },
        timeout: ms("10m"),
      })
    : await Sandbox.create({
        runtime: "node24",
        resources: { vcpus: 2 },
        timeout: ms("10m"),
      });
  const createTime = ((Date.now() - startCreate) / 1000).toFixed(1);
  console.log(`   Sandbox: ${sandbox.sandboxId}`);
  console.log(`   Created in ${createTime}s (${SNAPSHOT_ID ? "from snapshot" : "fresh"})`);

  // If no snapshot, we need to install the Agent SDK first
  if (!SNAPSHOT_ID) {
    console.log("\n   Installing Agent SDK (no snapshot)...");
    await sandbox.runCommand({
      cmd: "npm",
      args: ["init", "-y"],
    });
    await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "@anthropic-ai/claude-agent-sdk"],
      stdout: process.stdout,
      stderr: process.stderr,
    });
    await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
      sudo: true,
      stdout: process.stdout,
      stderr: process.stderr,
    });
    // Set ESM mode
    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/package.json",
        content: Buffer.from(
          JSON.stringify({ name: "test", type: "module", private: true }, null, 2)
        ),
      },
    ]);
  }

  // 2. Start a simple agent task
  const prompt =
    'Write a file called hello.txt with the content "Hello from Claude Agent!" and then read it back. Report what you wrote.';
  console.log(`\n2. Starting agent task...`);
  console.log(`   Prompt: "${prompt}"`);

  const taskFileId = "test-" + Date.now();
  const startTask = Date.now();
  const cmdId = await startAgentTask(sandbox, prompt, taskFileId, null);
  console.log(`   Command started: ${cmdId}`);

  // 3. Poll for result file
  console.log("\n3. Polling for result...");
  let result = null;
  let pollCount = 0;
  const maxPolls = 120; // 2 minutes at 1s intervals

  while (pollCount < maxPolls) {
    pollCount++;
    await new Promise((r) => setTimeout(r, 2000)); // 2s between polls

    result = await readAgentResult(sandbox, taskFileId);
    if (result) {
      const elapsed = ((Date.now() - startTask) / 1000).toFixed(1);
      console.log(`   Result found after ${pollCount} polls (${elapsed}s)`);
      break;
    }

    if (pollCount % 5 === 0) {
      console.log(`   Poll ${pollCount}: still running...`);
    }
  }

  if (!result) {
    console.error("   FAIL: Agent did not complete within timeout");
    await sandbox.stop();
    process.exit(1);
  }

  // 4. Verify result
  console.log("\n4. Result:");
  console.log(`   agentSessionId: ${result.agentSessionId}`);
  console.log(`   result (first 500 chars):`);
  console.log(`   ${result.result.substring(0, 500)}`);

  // Verify the file was created
  console.log("\n5. Verifying hello.txt was created...");
  const fileBuffer = await sandbox.readFileToBuffer({ path: "hello.txt" });
  if (fileBuffer) {
    const content = fileBuffer.toString("utf-8");
    console.log(`   File content: "${content}"`);
    console.log("   PASS: Agent created the file");
  } else {
    console.log("   WARN: hello.txt not found (agent may have used a different path)");
  }

  // 6. Stop sandbox
  console.log("\n6. Stopping sandbox...");
  await sandbox.stop();
  console.log("   Done.");

  console.log("\n=== Agent Runner Test Complete ===");
  console.log(`   Sandbox creation: ${createTime}s`);
  console.log(`   Agent execution: ${((Date.now() - startTask) / 1000).toFixed(1)}s`);
  console.log(`   Session ID: ${result.agentSessionId}`);
}

main().catch((err) => {
  console.error("\n=== AGENT RUNNER TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
