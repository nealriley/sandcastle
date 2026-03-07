/**
 * Phase 1: Sandbox Smoke Test
 *
 * Verifies:
 * 1. We can create a sandbox
 * 2. Run a command and read stdout
 * 3. Detached mode: start a command, poll for completion
 * 4. Stop the sandbox
 *
 * Run: pnpm smoke-test (from middleware/)
 */

import { Sandbox } from "@vercel/sandbox";

async function main() {
  console.log("=== Sandbox Smoke Test ===\n");

  // ── Test 1: Create sandbox + run blocking command ──────────────
  console.log("1. Creating sandbox...");
  const sandbox = await Sandbox.create({
    runtime: "node24",
    resources: { vcpus: 2 },
    timeout: 60_000, // 1 minute
  });
  console.log(`   Sandbox created: ${sandbox.sandboxId}`);
  console.log(`   Status: ${sandbox.status}`);

  console.log("\n2. Running blocking command: echo 'hello from sandbox'...");
  const echoResult = await sandbox.runCommand("echo", ["hello from sandbox"]);
  const echoOutput = (await echoResult.stdout()).trim();
  console.log(`   Exit code: ${echoResult.exitCode}`);
  console.log(`   Output: "${echoOutput}"`);

  if (echoOutput !== "hello from sandbox") {
    throw new Error(`Expected "hello from sandbox", got "${echoOutput}"`);
  }
  console.log("   PASS: Blocking command works");

  // ── Test 2: Write file + read file ────────────────────────────
  console.log("\n3. Writing file to sandbox...");
  await sandbox.writeFiles([
    { path: "test.txt", content: Buffer.from("file content here") },
  ]);
  console.log("   File written");

  console.log("   Reading file back...");
  const buffer = await sandbox.readFileToBuffer({ path: "test.txt" });
  const fileContent = buffer?.toString("utf-8");
  console.log(`   Content: "${fileContent}"`);

  if (fileContent !== "file content here") {
    throw new Error(`Expected "file content here", got "${fileContent}"`);
  }
  console.log("   PASS: File read/write works");

  // ── Test 3: Detached command + polling ─────────────────────────
  console.log("\n4. Starting detached command: sleep 3 && echo 'done'...");
  const detachedCmd = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", "sleep 3 && echo 'detached-done'"],
    detached: true,
  });
  console.log(`   Command started: ${detachedCmd.cmdId}`);
  console.log(`   Exit code (should be null): ${detachedCmd.exitCode}`);

  // Wait for the detached command using the built-in wait() method
  console.log("   Waiting for completion via cmd.wait()...");
  const startWait = Date.now();
  const finishedCmd = await detachedCmd.wait();
  const elapsed = ((Date.now() - startWait) / 1000).toFixed(1);
  const output = (await finishedCmd.stdout()).trim();
  console.log(`   Completed in ${elapsed}s`);
  console.log(`   Exit code: ${finishedCmd.exitCode}`);
  console.log(`   Output: "${output}"`);

  if (output !== "detached-done") {
    throw new Error(`Expected "detached-done", got "${output}"`);
  }
  console.log("   PASS: Detached command + wait works");

  // ── Test 4b: Detached + polling via getCommand ──────────────────
  console.log("\n4b. Testing getCommand polling on a quick command...");
  const quickCmd = await sandbox.runCommand({
    cmd: "echo",
    args: ["poll-test"],
    detached: true,
  });
  console.log(`   Command started: ${quickCmd.cmdId}`);

  // Give it a moment to finish
  await new Promise((r) => setTimeout(r, 2000));

  const polledCmd = await sandbox.getCommand(quickCmd.cmdId);
  console.log(`   exitCode: ${polledCmd.exitCode}`);
  const pollOutput = (await polledCmd.stdout()).trim();
  console.log(`   Output: "${pollOutput}"`);

  if (polledCmd.exitCode !== 0 || pollOutput !== "poll-test") {
    console.log("   WARN: getCommand polling returned unexpected result — will use wait() strategy");
  } else {
    console.log("   PASS: getCommand polling works");
  }

  // ── Test 4: Stop sandbox ──────────────────────────────────────
  console.log("\n5. Stopping sandbox...");
  await sandbox.stop();
  console.log(`   Status: ${sandbox.status}`);
  console.log("   PASS: Sandbox stopped");

  console.log("\n=== All smoke tests passed ===");
}

main().catch((err) => {
  console.error("\n=== SMOKE TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
