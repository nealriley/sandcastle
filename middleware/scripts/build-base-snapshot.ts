/**
 * Phase 2: Build Base Snapshot
 *
 * Creates a Vercel Sandbox with the Claude Agent SDK and CLI pre-installed,
 * then takes a snapshot. New sessions create from this snapshot for fast startup.
 *
 * Run: pnpm build-snapshot (from middleware/)
 *
 * After running, set the output snapshot ID as BASE_SNAPSHOT_ID env var:
 *   vercel env add BASE_SNAPSHOT_ID
 *   vercel env pull
 */

import { Sandbox } from "@vercel/sandbox";
import ms from "ms";

async function main() {
  console.log("=== Building Base Snapshot ===\n");

  // 1. Create fresh sandbox
  console.log("1. Creating sandbox (4 vCPUs, 15 min timeout)...");
  const sandbox = await Sandbox.create({
    runtime: "node24",
    resources: { vcpus: 4 },
    timeout: ms("15m"),
  });
  console.log(`   Sandbox: ${sandbox.sandboxId}\n`);

  // 2. Install Claude Code CLI (required by Agent SDK)
  console.log("2. Installing Claude Code CLI (global)...");
  const installCLI = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "-g", "@anthropic-ai/claude-code"],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  if (installCLI.exitCode !== 0) {
    throw new Error(`Claude Code CLI install failed (exit ${installCLI.exitCode})`);
  }
  console.log("   Done.\n");

  // 3. Install Claude Agent SDK in the working directory
  console.log("3. Installing Claude Agent SDK...");
  const installSDK = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "@anthropic-ai/claude-agent-sdk"],
    stdout: process.stdout,
    stderr: process.stderr,
  });
  if (installSDK.exitCode !== 0) {
    throw new Error(`Agent SDK install failed (exit ${installSDK.exitCode})`);
  }
  console.log("   Done.\n");

  // 4. Set up package.json for ESM imports
  console.log("4. Writing package.json for ESM...");
  await sandbox.writeFiles([
    {
      path: "/vercel/sandbox/package.json",
      content: Buffer.from(
        JSON.stringify(
          {
            name: "sandbox-workspace",
            type: "module",
            private: true,
          },
          null,
          2
        )
      ),
    },
  ]);
  console.log("   Done.\n");

  // 5. Install common dev tools
  console.log("5. Installing common global tools...");
  const installTools = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "-g", "typescript", "tsx"],
    sudo: true,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  if (installTools.exitCode !== 0) {
    console.warn("   Warning: some tools failed to install (non-critical)");
  }
  console.log("   Done.\n");

  // 6. Verify the Agent SDK loads
  console.log("6. Verifying Agent SDK import...");
  const verify = await sandbox.runCommand({
    cmd: "node",
    args: [
      "-e",
      'import("@anthropic-ai/claude-agent-sdk").then(() => console.log("Agent SDK loaded OK")).catch(e => { console.error(e); process.exit(1); })',
    ],
  });
  const verifyOutput = (await verify.stdout()).trim();
  console.log(`   ${verifyOutput}`);
  if (verify.exitCode !== 0) {
    const errOutput = await verify.stderr();
    console.error(`   Stderr: ${errOutput}`);
    throw new Error("Agent SDK verification failed");
  }
  console.log("   Done.\n");

  // 7. Take snapshot (sandbox stops automatically after this)
  console.log("7. Creating snapshot (this stops the sandbox)...");
  const snapshot = await sandbox.snapshot({ expiration: 0 }); // Never expires
  console.log(`   Snapshot ID: ${snapshot.snapshotId}`);
  console.log(`   Status: ${snapshot.status}`);
  console.log(`   Size: ${(snapshot.sizeBytes / 1024 / 1024).toFixed(1)} MB`);

  console.log("\n=== Snapshot Built Successfully ===");
  console.log(`\nNext steps:`);
  console.log(`  1. Set this as an env var on your Vercel project:`);
  console.log(`     vercel env add BASE_SNAPSHOT_ID`);
  console.log(`     (paste: ${snapshot.snapshotId})`);
  console.log(`  2. Re-pull env vars:`);
  console.log(`     vercel env pull`);
}

main().catch((err) => {
  console.error("\n=== SNAPSHOT BUILD FAILED ===");
  console.error(err);
  process.exit(1);
});
