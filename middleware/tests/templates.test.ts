import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTemplateConfiguration,
  getCreatableSandcastleTemplate,
  getSandcastleTemplate,
  resolveTemplateEnvironment,
  resolveTemplatePrompt,
  summarizeTemplateRuntimes,
} from "../lib/templates.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

test("getSandcastleTemplate returns the reset built-in templates by slug", () => {
  const claudeCode = getSandcastleTemplate("claude-code");
  const codex = getSandcastleTemplate("codex");
  const websiteDeepDive = getSandcastleTemplate("website-deep-dive");
  const wordcount = getSandcastleTemplate("wordcount");

  assert.equal(claudeCode?.name, "Claude Code");
  assert.equal(codex?.status, "live");
  assert.equal(claudeCode?.envHints[0]?.inputType, "select");
  assert.equal(codex?.envHints[0]?.inputType, "select");
  assert.equal(websiteDeepDive?.name, "Website Deep Dive");
  assert.equal(websiteDeepDive?.envHints[0]?.inputType, "select");
  assert.equal(wordcount?.executionStrategy.kind, "shell-command");
  assert.equal(wordcount?.envHints[0]?.key, "WORDCOUNT_METHOD");
  assert.equal(wordcount?.envHints[0]?.inputType, "select");
  assert.equal(getSandcastleTemplate("missing"), null);
});

test("getCreatableSandcastleTemplate only returns live templates", () => {
  assert.equal(
    getCreatableSandcastleTemplate("claude-code")?.slug,
    "claude-code"
  );
  assert.equal(getCreatableSandcastleTemplate("codex")?.slug, "codex");
  assert.equal(
    getCreatableSandcastleTemplate("website-deep-dive")?.slug,
    "website-deep-dive"
  );
  assert.equal(getCreatableSandcastleTemplate("wordcount")?.slug, "wordcount");
});

test("assertTemplateConfiguration accepts the current built-in registry", () => {
  assert.doesNotThrow(() => assertTemplateConfiguration());
});

test("summarizeTemplateRuntimes renders user-facing runtime labels", () => {
  const template = getSandcastleTemplate("claude-code");
  assert.ok(template);
  assert.equal(summarizeTemplateRuntimes(template), "Node 24, Node 22");
});

test("resolveTemplatePrompt gives Claude Code a light structured artifact workflow", () => {
  const template = getSandcastleTemplate("claude-code");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(
    template,
    "Update the dashboard styles. ```sandcastle-request\n{\"template\":\"claude-code\",\"version\":1,\"mode\":\"task\",\"prompt\":\"Update the dashboard styles.\",\"inputs\":{},\"constraints\":[],\"artifactsRequested\":[\"result.json\",\"result.md\"]}\n```",
    {
      INTERNAL_API_TOKEN: "secret-token",
    }
  );

  assert.match(prompt, /Claude Code template/);
  assert.match(prompt, /request\.json/);
  assert.match(prompt, /result\.json/);
  assert.match(prompt, /sandcastle-request/);
  assert.doesNotMatch(prompt, /secret-token/);
});

test("resolveTemplatePrompt gives Codex a stricter structured contract", () => {
  const template = getSandcastleTemplate("codex");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(
    template,
    "Transform the API response shape and emit the structured artifacts.",
    {
      SERVICE_ACCOUNT_TOKEN: "super-secret-token",
    }
  );

  assert.match(prompt, /Codex template/);
  assert.match(prompt, /template-contract\.mjs/);
  assert.match(prompt, /result\.md/);
  assert.doesNotMatch(prompt, /super-secret-token/);
});

test("resolveTemplatePrompt gives Website Deep Dive concrete investigation instructions", () => {
  const template = getSandcastleTemplate("website-deep-dive");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(
    template,
    "Deep dive https://example.com and tell me what the product does.",
    {
      WEBSITE_AUTH_TOKEN: "secret-token",
    }
  );

  assert.match(prompt, /Website Deep Dive template/);
  assert.match(prompt, /curl/);
  assert.match(prompt, /https:\/\/example\.com/);
  assert.match(prompt, /result\.json/);
  assert.doesNotMatch(prompt, /secret-token/);
});

test("resolveTemplatePrompt returns the raw prompt for prompt-capable shell-command templates", () => {
  const template = getSandcastleTemplate("wordcount");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(
    template,
    "/vercel/sandbox/custom.txt",
    {
      INTERNAL_API_TOKEN: "secret-token",
    }
  );

  assert.equal(prompt, "/vercel/sandbox/custom.txt");
});

test("resolveTemplateEnvironment preserves explicit values and applies provider defaults", () => {
  const template = getSandcastleTemplate("claude-code");
  assert.ok(template);

  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "platform-anthropic-key";

  try {
    const resolved = resolveTemplateEnvironment(
      template,
      { CUSTOM_VALUE: "secret" },
      { templateValidationUrl: "https://unused.example.test" }
    );

    assert.deepEqual(resolved, {
      ANTHROPIC_API_KEY: "platform-anthropic-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
      CUSTOM_VALUE: "secret",
    });
  } finally {
    process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
  }
});

test("resolveTemplateEnvironment applies wordcount defaults from template config", () => {
  const template = getSandcastleTemplate("wordcount");
  assert.ok(template);

  const resolved = resolveTemplateEnvironment(template, {});

  assert.deepEqual(resolved, {
    WORDCOUNT_METHOD: "wc-words",
  });
});

test("provider templates bootstrap the contract files and helper script", async () => {
  const template = getSandcastleTemplate("claude-code");
  assert.ok(template);

  const sandbox = new FakeSandbox();
  await template.bootstrap(sandbox as never, {
    runtime: "node24",
    environment: {
      SANDBOX_ENDPOINT: "https://example.test",
      SANDBOX_TOKEN: "secret",
    },
  });

  const readme = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/README.md",
  });
  const contract = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/CONTRACT.md",
  });
  const manifest = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/env-keys.txt",
  });
  const requestExample = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/request.example.json",
  });
  const resultMarkdown = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/result.md",
  });
  const showContract = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/show-contract.sh",
  });

  assert.ok(readme);
  assert.ok(contract);
  assert.ok(manifest);
  assert.ok(requestExample);
  assert.ok(resultMarkdown);
  assert.ok(showContract);

  assert.match(readme.toString("utf-8"), /Sandcastle Claude Code Template/);
  assert.equal(
    manifest.toString("utf-8"),
    "SANDBOX_ENDPOINT\nSANDBOX_TOKEN\n"
  );
  assert.match(requestExample.toString("utf-8"), /"template": "claude-code"/);
  assert.match(resultMarkdown.toString("utf-8"), /# Claude Code Result/);
  assert.deepEqual(sandbox.commandLog, [
    {
      cmd: "bash",
      args: ["-lc", "chmod +x /vercel/sandbox/sandcastle-template/show-contract.sh"],
    },
  ]);
});

test("wordcount bootstrap writes the sample file for the shell command runner", async () => {
  const template = getSandcastleTemplate("wordcount");
  assert.ok(template);

  const sandbox = new FakeSandbox();
  await template.bootstrap(sandbox as never, {
    runtime: "node24",
    environment: {},
  });

  const fixture = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/wordcount.txt",
  });
  const readme = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/README.wordcount.md",
  });

  assert.equal(fixture?.toString("utf-8"), "alpha\nbeta\ngamma\ndelta\n");
  assert.match(readme?.toString("utf-8") ?? "", /WORDCOUNT_METHOD/);
  assert.match(readme?.toString("utf-8") ?? "", /wc-words/);
});
