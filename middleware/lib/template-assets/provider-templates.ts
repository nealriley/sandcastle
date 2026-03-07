export const PROVIDER_TEMPLATE_DIR = "/vercel/sandbox/sandcastle-template";

export type ProviderTemplateKind = "claude-code" | "codex";

function providerDisplayName(provider: ProviderTemplateKind): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

function providerFocusLine(provider: ProviderTemplateKind): string {
  return provider === "claude-code"
    ? "This template is optimized for clean, human-first coding work with a lightweight structured contract."
    : "This template is optimized for integration-driven coding work with a stricter structured request/result contract.";
}

export function buildProviderEnvironmentManifest(
  environment: Record<string, string>
): string {
  const keys = Object.keys(environment).sort();
  return keys.length > 0 ? `${keys.join("\n")}\n` : "";
}

export function buildProviderTemplateReadme(
  provider: ProviderTemplateKind
): string {
  const displayName = providerDisplayName(provider);

  return [
    `# Sandcastle ${displayName} Template`,
    "",
    providerFocusLine(provider),
    "",
    "Canonical files:",
    "- ./sandcastle-template/CONTRACT.md",
    "- ./sandcastle-template/env-keys.txt",
    "- ./sandcastle-template/request.example.json",
    "- ./sandcastle-template/result.example.json",
    "- ./sandcastle-template/request.json",
    "- ./sandcastle-template/result.json",
    "- ./sandcastle-template/result.md",
    "- ./sandcastle-template/template-contract.mjs",
    "- ./sandcastle-template/show-contract.sh",
    "",
    "Advanced callers may embed a structured request block in the user prompt:",
    "```sandcastle-request",
    "{ ...json... }",
    "```",
    "",
    "Sandcastle still returns the normal TaskResponse shape. Structured template",
    "artifacts live in request.json, result.json, and result.md inside the sandbox.",
    "",
  ].join("\n");
}

export function buildProviderTemplateContract(
  provider: ProviderTemplateKind
): string {
  return [
    `# ${providerDisplayName(provider)} Request / Result Contract`,
    "",
    "This template supports both plain prompts and structured prompt blocks.",
    "",
    "## Structured request block",
    "",
    "Use this fenced block in the prompt when an integration needs a stable contract:",
    "",
    "```sandcastle-request",
    "{",
    `  "template": "${provider}",`,
    '  "version": 1,',
    '  "mode": "task",',
    '  "prompt": "Describe the work to perform",',
    '  "inputs": {},',
    '  "constraints": [],',
    '  "artifactsRequested": []',
    "}",
    "```",
    "",
    "## Canonical files",
    "",
    "- `request.json`",
    "  The request envelope the agent used for this task.",
    "- `result.json`",
    "  The machine-readable result envelope.",
    "- `result.md`",
    "  The human-readable summary aligned with the final TaskResponse.result.",
    "",
    "## Result envelope",
    "",
    "{",
    `  "template": "${provider}",`,
    '  "version": 1,',
    '  "status": "success | needs_input | failed",',
    '  "summary": "Human summary surfaced through Sandcastle",',
    '  "artifacts": [',
    `    { "label": "machine-readable result", "path": "${PROVIDER_TEMPLATE_DIR}/result.json", "kind": "file" },`,
    `    { "label": "human summary", "path": "${PROVIDER_TEMPLATE_DIR}/result.md", "kind": "file" }`,
    "  ],",
    '  "nextActions": [],',
    '  "output": null',
    "}",
    "",
    "The final assistant response should remain a concise natural-language",
    "summary, because Sandcastle status APIs surface the latest response text",
    "rather than raw JSON.",
    "",
  ].join("\n");
}

export function buildProviderTemplateRequestExample(
  provider: ProviderTemplateKind
): string {
  return JSON.stringify(
    {
      template: provider,
      version: 1,
      mode: "task",
      prompt: "Implement the requested change and summarize the outcome.",
      inputs: {
        filesOfInterest: [],
        urls: [],
      },
      constraints: [
        "Keep the final response concise.",
        "Write result.json and result.md before finishing.",
      ],
      artifactsRequested: ["result.json", "result.md"],
    },
    null,
    2
  );
}

export function buildProviderTemplateResultExample(
  provider: ProviderTemplateKind
): string {
  return JSON.stringify(
    {
      template: provider,
      version: 1,
      status: "success",
      summary: "Implemented the requested change and updated the structured artifacts.",
      artifacts: [
        {
          label: "machine-readable result",
          path: `${PROVIDER_TEMPLATE_DIR}/result.json`,
          kind: "file",
        },
        {
          label: "human summary",
          path: `${PROVIDER_TEMPLATE_DIR}/result.md`,
          kind: "file",
        },
      ],
      nextActions: [],
      output: null,
    },
    null,
    2
  );
}

export function buildProviderTemplateRequestPlaceholder(
  provider: ProviderTemplateKind
): string {
  return JSON.stringify(
    {
      template: provider,
      version: 1,
      mode: "task",
      prompt: "Replace this placeholder with the current task prompt.",
      inputs: {},
      constraints: [],
      artifactsRequested: ["result.json", "result.md"],
    },
    null,
    2
  );
}

export function buildProviderTemplateResultPlaceholder(
  provider: ProviderTemplateKind
): string {
  return JSON.stringify(
    {
      template: provider,
      version: 1,
      status: "needs_input",
      summary: "No task has completed yet.",
      artifacts: [],
      nextActions: [
        "Perform a task with this template, then replace this file with the final structured result.",
      ],
      output: null,
    },
    null,
    2
  );
}

export function buildProviderTemplateResultMarkdown(
  provider: ProviderTemplateKind
): string {
  return [
    `# ${providerDisplayName(provider)} Result`,
    "",
    "No task has completed yet.",
    "",
    "Run a task with this template, then replace this file with the final human",
    "summary that matches result.json.summary.",
    "",
  ].join("\n");
}

export function buildProviderTemplateContractLibrary(): string {
  return [
    'import fs from "node:fs/promises";',
    "",
    "export const REQUEST_BLOCK_PATTERN = /```sandcastle-request\\s*([\\s\\S]*?)```/i;",
    "",
    "export function extractStructuredRequestBlock(text) {",
    "  const match = REQUEST_BLOCK_PATTERN.exec(text);",
    "  if (!match || !match[1]) {",
    "    return null;",
    "  }",
    "  return JSON.parse(match[1]);",
    "}",
    "",
    "export function buildRequestEnvelope({",
    "  template,",
    '  version = 1,',
    '  mode = "task",',
    "  prompt,",
    "  inputs = {},",
    "  constraints = [],",
    "  artifactsRequested = [],",
    "}) {",
    "  return {",
    "    template,",
    "    version,",
    "    mode,",
    "    prompt,",
    "    inputs,",
    "    constraints,",
    "    artifactsRequested,",
    "  };",
    "}",
    "",
    "export function buildResultEnvelope({",
    "  template,",
    '  version = 1,',
    '  status = "success",',
    "  summary,",
    "  artifacts = [],",
    "  nextActions = [],",
    "  output = null,",
    "}) {",
    "  return {",
    "    template,",
    "    version,",
    "    status,",
    "    summary,",
    "    artifacts,",
    "    nextActions,",
    "    output,",
    "  };",
    "}",
    "",
    "export async function writeJson(path, value) {",
    '  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\\n`);',
    "}",
    "",
  ].join("\n");
}

export function buildProviderTemplateShowContractScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'template_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'echo "README:"',
    'cat "${template_dir}/README.md"',
    'printf "\\n\\nCONTRACT:\\n"',
    'cat "${template_dir}/CONTRACT.md"',
    'printf "\\n\\nREQUEST EXAMPLE:\\n"',
    'cat "${template_dir}/request.example.json"',
    'printf "\\n\\nRESULT EXAMPLE:\\n"',
    'cat "${template_dir}/result.example.json"',
    "",
  ].join("\n");
}
