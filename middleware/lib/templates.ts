import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import {
  buildProviderEnvironmentManifest,
  buildProviderTemplateContract,
  buildProviderTemplateContractLibrary,
  buildProviderTemplateReadme,
  buildProviderTemplateRequestExample,
  buildProviderTemplateRequestPlaceholder,
  buildProviderTemplateResultExample,
  buildProviderTemplateResultMarkdown,
  buildProviderTemplateResultPlaceholder,
  buildProviderTemplateShowContractScript,
  PROVIDER_TEMPLATE_DIR,
  type ProviderTemplateKind,
} from "./template-assets/provider-templates";
import {
  buildWebpageInspectorCli,
  buildWebpageInspectorLibrary,
  buildWebpageInspectorPlaceholderReport,
  buildWebpageInspectorReadme,
  buildWebpageInspectorScript,
  buildWebpageInspectorServeScript,
  buildWebpageInspectorShowSummaryScript,
  WEBPAGE_INSPECTOR_OUTPUT_DIR,
  WEBPAGE_INSPECTOR_PORT,
  WEBPAGE_INSPECTOR_REPORT_DIR,
  WEBPAGE_INSPECTOR_TEMPLATE_DIR,
} from "./template-assets/webpage-inspector";
import type {
  RuntimeName,
  TemplateSummary,
} from "./types.js";
import {
  applyExecutionStrategyEnvironmentDefaults,
  executionStrategyAcceptsPrompts,
} from "./execution-strategy";
import type {
  ExecutionStrategy,
  TemplateEnvironmentFieldInputType,
  TemplateEnvironmentFieldOption,
} from "./template-service-types.js";

const DEFAULT_TEMPLATE_PORTS = [3000, 5173, 8888];
const VALIDATION_TEMPLATE_DIR = "/vercel/sandbox/sandcastle-template";

export type SandcastleTemplateStatus = "live" | "planned";

export interface SandcastleTemplateEnvHint {
  key: string;
  label: string;
  description: string;
  required?: boolean;
  secret?: boolean;
  defaultValue?: string | null;
  inputType?: TemplateEnvironmentFieldInputType;
  options?: TemplateEnvironmentFieldOption[];
}

export type SandcastleTemplateSource =
  | {
      kind: "runtime";
    }
  | {
      kind: "snapshot";
      snapshotEnvVar: string;
      snapshotRuntime: RuntimeName;
    };

export interface SandcastleTemplateDefinition {
  slug: string;
  name: string;
  status: SandcastleTemplateStatus;
  summary: string;
  purpose: string;
  source: SandcastleTemplateSource;
  defaultRuntime: RuntimeName;
  supportedRuntimes: RuntimeName[];
  executionStrategy: ExecutionStrategy;
  launchLabel: string;
  ports: number[];
  timeoutMs: number;
  vcpus: number;
  promptPlaceholder: string;
  defaultPrompt?: string;
  envHints: SandcastleTemplateEnvHint[];
  bootstrap: (
    sandbox: Sandbox,
    context: {
      runtime: RuntimeName;
      environment: Record<string, string>;
    }
  ) => Promise<void>;
  buildInitialPrompt: (args: {
    prompt: string;
    environment: Record<string, string>;
  }) => string;
}

export type SandcastleTemplateCatalogEntry = Omit<
  SandcastleTemplateDefinition,
  "bootstrap" | "buildInitialPrompt" | "source" | "executionStrategy"
> & {
  sourceKind: SandcastleTemplateSource["kind"];
  executionStrategyKind: ExecutionStrategy["kind"];
  acceptsPrompts: boolean;
};

export interface TemplateEnvironmentDefaults {
  templateValidationUrl?: string;
}

export const DEFAULT_TEMPLATE_SLUG = "claude-code";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
const DEFAULT_OPENAI_MODEL = "gpt-5.2-codex";
const DEFAULT_WORDCOUNT_METHOD = "wc-words";
const DEFAULT_WORDCOUNT_TEXT = "alpha beta gamma delta";

const CLAUDE_MODEL_OPTIONS: TemplateEnvironmentFieldOption[] = [
  {
    value: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    description: "Balanced default for most coding tasks.",
  },
  {
    value: "claude-opus-4-1",
    label: "Claude Opus 4.1",
    description: "Stronger reasoning for harder tasks.",
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Faster and cheaper for lighter work.",
  },
];

const OPENAI_MODEL_OPTIONS: TemplateEnvironmentFieldOption[] = [
  {
    value: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "Latest high-capability Codex model.",
  },
  {
    value: "gpt-5-codex",
    label: "GPT-5 Codex",
    description: "Stable default Codex model.",
  },
  {
    value: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex Mini",
    description: "Faster and cheaper for lighter tasks.",
  },
];

const WORDCOUNT_METHOD_OPTIONS: TemplateEnvironmentFieldOption[] = [
  {
    value: "wc-words",
    label: "wc -w",
    description: "Use wc -w for the fastest shell-native word count.",
  },
  {
    value: "awk-fields",
    label: "awk fields",
    description: "Use awk and sum whitespace-delimited fields line by line.",
  },
  {
    value: "grep-tokens",
    label: "grep tokens",
    description: "Tokenize non-whitespace sequences with grep before counting.",
  },
];

function noOpBootstrap(): Promise<void> {
  return Promise.resolve();
}

function buildValidationManifest(environment: Record<string, string>): string {
  const keys = Object.keys(environment).sort();
  if (keys.length === 0) {
    return "";
  }

  return `${keys.join("\n")}\n`;
}

function buildEnvironmentManifest(environment: Record<string, string>): string {
  return buildValidationManifest(environment);
}

async function bootstrapProviderTemplate(
  provider: ProviderTemplateKind,
  sandbox: Sandbox,
  context: {
    runtime: RuntimeName;
    environment: Record<string, string>;
  }
): Promise<void> {
  const manifest = buildProviderEnvironmentManifest(context.environment);
  await sandbox.writeFiles([
    {
      path: `${PROVIDER_TEMPLATE_DIR}/README.md`,
      content: Buffer.from(buildProviderTemplateReadme(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/CONTRACT.md`,
      content: Buffer.from(buildProviderTemplateContract(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/env-keys.txt`,
      content: Buffer.from(manifest),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/request.example.json`,
      content: Buffer.from(buildProviderTemplateRequestExample(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/result.example.json`,
      content: Buffer.from(buildProviderTemplateResultExample(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/request.json`,
      content: Buffer.from(buildProviderTemplateRequestPlaceholder(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/result.json`,
      content: Buffer.from(buildProviderTemplateResultPlaceholder(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/result.md`,
      content: Buffer.from(buildProviderTemplateResultMarkdown(provider)),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/template-contract.mjs`,
      content: Buffer.from(buildProviderTemplateContractLibrary()),
    },
    {
      path: `${PROVIDER_TEMPLATE_DIR}/show-contract.sh`,
      content: Buffer.from(buildProviderTemplateShowContractScript()),
    },
  ]);

  const chmodResult = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `chmod +x ${PROVIDER_TEMPLATE_DIR}/show-contract.sh`],
  });

  if (chmodResult.exitCode !== 0) {
    throw new Error(`Failed to finalize ${provider} template scripts.`);
  }
}

function buildProviderTemplatePrompt(
  provider: ProviderTemplateKind,
  args: {
    prompt: string;
    environment: Record<string, string>;
  }
): string {
  const envKeys = Object.keys(args.environment).sort();
  const displayName = provider === "claude-code" ? "Claude Code" : "Codex";
  const userPrompt = args.prompt.trim();

  const sharedLines = [
    `This sandbox was created from the Sandcastle ${displayName} template.`,
    `Canonical template files live in ${PROVIDER_TEMPLATE_DIR}.`,
    "",
    "Available helpers:",
    "- ./sandcastle-template/show-contract.sh",
    "- ./sandcastle-template/template-contract.mjs",
    "- ./sandcastle-template/request.json",
    "- ./sandcastle-template/result.json",
    "- ./sandcastle-template/result.md",
    "",
    "The template supports an optional fenced structured request block in the user prompt:",
    "```sandcastle-request",
    "{ ...json... }",
    "```",
    "",
    envKeys.length > 0
      ? `Launch environment variables available to the sandbox: ${envKeys.join(", ")}. Never print secret values directly.`
      : "No launch environment variables were configured for this sandbox.",
    "",
  ];

  const workflowLines =
    provider === "claude-code"
      ? [
          "Use this template like a clean, human-first coding assistant with light structured artifacts.",
          "",
          "Required workflow:",
          "1. If the user prompt contains a ```sandcastle-request JSON block, treat it as the source of truth and mirror it into request.json.",
          "2. If there is no structured block, synthesize a simple request.json envelope from the current task.",
          "3. Inspect the workspace, perform the coding work, and keep the approach pragmatic.",
          "4. Before finishing, update result.json and result.md so result.json.summary matches your final response.",
          "5. Keep the final response concise, clear, and aligned with the structured artifacts.",
        ]
      : [
          "Use this template like an integration-first coding agent with a stable request/result contract.",
          "",
          "Required workflow:",
          "1. Inspect the user prompt for a ```sandcastle-request JSON block first.",
          "2. If the block exists, parse it and use it as the source of truth.",
          "3. If it does not exist, synthesize request.json from the plain-language prompt before doing any other work.",
          "4. Keep request.json, result.json, and result.md updated in stable locations throughout the task.",
          "5. Use template-contract.mjs whenever helpful to keep envelopes valid and machine-readable.",
          "6. Finalize result.json and result.md before your last response, and keep the final response tightly aligned with result.json.summary.",
        ];

  return [...sharedLines, ...workflowLines, "", `User request: ${userPrompt}`].join(
    "\n"
  );
}

function buildClaudeCodePrompt(args: {
  prompt: string;
  environment: Record<string, string>;
}): string {
  return buildProviderTemplatePrompt("claude-code", args);
}

function buildCodexPrompt(args: {
  prompt: string;
  environment: Record<string, string>;
}): string {
  return buildProviderTemplatePrompt("codex", args);
}

function buildWebsiteDeepDivePrompt(args: {
  prompt: string;
  environment: Record<string, string>;
}): string {
  const envKeys = Object.keys(args.environment).sort();

  return [
    "This sandbox was created from the Sandcastle Website Deep Dive template.",
    `Base template files live in ${PROVIDER_TEMPLATE_DIR}, and this workflow inherits the Claude Code artifact contract.`,
    "",
    "Required workflow:",
    "1. Identify the primary website or URL targets from the user request before drawing conclusions.",
    "2. Inspect the site directly with pragmatic tooling such as curl, fetched HTML, headers, and repository clues when available.",
    "3. Analyze the site's positioning, audience, navigation, content structure, trust signals, forms, SEO metadata, and likely technical stack.",
    "4. Keep request.json, result.json, and result.md aligned with the investigation as you learn more.",
    "5. End with a concise brief covering what the site does, who it serves, how it appears to be built, and the highest-signal opportunities or risks.",
    "",
    envKeys.length > 0
      ? `Launch environment variables available to the sandbox: ${envKeys.join(", ")}. Never print secret values directly.`
      : "No launch environment variables were configured for this sandbox.",
    "",
    `User request: ${args.prompt.trim()}`,
  ].join("\n");
}

const WORDCOUNT_TEMPFILE_GLOB = "/tmp/wordcount-input.*";
const WORDCOUNT_TEMPLATE_COMMAND = `
text="\${WORDCOUNT_TEXT:-${DEFAULT_WORDCOUNT_TEXT}}"
method="\${WORDCOUNT_METHOD:-${DEFAULT_WORDCOUNT_METHOD}}"
tmpfile="$(mktemp /tmp/wordcount-input.XXXXXX)"
trap 'rm -f "$tmpfile"' EXIT

printf '%s' "$text" > "$tmpfile"

case "$method" in
  wc-words)
    count=$(wc -w < "$tmpfile" | tr -d '[:space:]')
    ;;
  awk-fields)
    count=$(awk '{ total += NF } END { print total + 0 }' "$tmpfile")
    ;;
  grep-tokens)
    count=$({ grep -oE '[^[:space:]]+' "$tmpfile" || true; } | wc -l | tr -d '[:space:]')
    ;;
  *)
    echo "Unsupported WORDCOUNT_METHOD: $method" >&2
    exit 2
    ;;
esac

chars=$(wc -m < "$tmpfile" | tr -d '[:space:]')

printf 'Method: %s\nCharacter count: %s\nWord count: %s\n' "$method" "$chars" "$count"
`.trim();

async function bootstrapWordcountTemplate(
  sandbox: Sandbox
): Promise<void> {
  await sandbox.writeFiles([
    {
      path: "/vercel/sandbox/README.wordcount.md",
      content: Buffer.from(
        [
          "# Wordcount Template",
          "",
          "This template runs a shell command with two config-driven inputs:",
          "",
          `- Prompt input via \`WORDCOUNT_TEXT\`, defaulting to \`${DEFAULT_WORDCOUNT_TEXT}\``,
          `- Select input via \`WORDCOUNT_METHOD\`, defaulting to \`${DEFAULT_WORDCOUNT_METHOD}\``,
          "",
          "Available methods:",
          "- wc-words",
          "- awk-fields",
          "- grep-tokens",
          "",
          "The startup command writes the prompt text to a temporary file and runs the selected counting method against that input.",
          "",
          `Temporary input files match \`${WORDCOUNT_TEMPFILE_GLOB}\` for the life of the command only.`,
          "",
          "It exists to validate prompt-capable shell-command execution and template-config selects end to end.",
          "",
        ].join("\n")
      ),
    },
  ]);
}

function buildValidationReadme(): string {
  return [
    "# Sandcastle Shell Scripts Validation Template",
    "",
    "This template proves that Sandcastle template bootstrapping and sandbox",
    "environment wiring are working correctly.",
    "",
    "Available scripts:",
    "- ./sandcastle-template/verify-runtime.sh",
    "- ./sandcastle-template/verify-env.sh",
    "- ./sandcastle-template/verify-request.sh",
    "- ./sandcastle-template/verify-all.sh",
    "",
    "Launch-time variables used by verify-request.sh:",
    "- VALIDATION_REQUEST_URL",
    "- VALIDATION_API_KEY (optional)",
    "- VALIDATION_AUTH_HEADER_NAME (optional, defaults to Authorization)",
    "- VALIDATION_AUTH_SCHEME (optional, defaults to Bearer when using Authorization)",
    "",
    "The scripts never print secret values directly. They report presence, length,",
    "and request metadata so you can confirm the template behaves correctly.",
    "If VALIDATION_REQUEST_URL is not provided manually, Sandcastle injects its",
    "own /api/template-validation endpoint by default.",
    "",
  ].join("\n");
}

function buildRuntimeScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'template_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'echo "Template directory: ${template_dir}"',
    'echo "Workspace: $(pwd)"',
    'echo "Shell: ${SHELL:-unknown}"',
    'if command -v node >/dev/null 2>&1; then',
    '  echo "Node: $(node -v)"',
    "fi",
    'if command -v npm >/dev/null 2>&1; then',
    '  echo "npm: $(npm -v)"',
    "fi",
    'if command -v python3 >/dev/null 2>&1; then',
    '  echo "Python: $(python3 --version 2>&1)"',
    "fi",
    'echo "Template files:"',
    'ls -1 "${template_dir}"',
    "",
  ].join("\n");
}

function buildEnvironmentScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'template_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'manifest="${template_dir}/env-keys.txt"',
    "",
    'if [[ ! -f "${manifest}" ]]; then',
    '  echo "No environment key manifest was generated."',
    "  exit 1",
    "fi",
    "",
    'mapfile -t keys < "${manifest}"',
    'if [[ ${#keys[@]} -eq 0 ]]; then',
    '  echo "No launch environment variables were configured."',
    "  exit 0",
    "fi",
    "",
    'for key in "${keys[@]}"; do',
    '  if [[ -z "${key}" ]]; then',
    "    continue",
    "  fi",
    '  if printenv "${key}" >/dev/null 2>&1; then',
    '    value="$(printenv "${key}")"',
    '    echo "${key}: present (length ${#value})"',
    "  else",
    '    echo "${key}: missing"',
    "  fi",
    "done",
    "",
  ].join("\n");
}

function buildRequestScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'request_url="${VALIDATION_REQUEST_URL:-}"',
    'api_key="${VALIDATION_API_KEY:-}"',
    'header_name="${VALIDATION_AUTH_HEADER_NAME:-Authorization}"',
    'auth_scheme="${VALIDATION_AUTH_SCHEME:-Bearer}"',
    "",
    'if [[ -z "${request_url}" ]]; then',
    '  echo "VALIDATION_REQUEST_URL is not set."',
    "  exit 1",
    "fi",
    "",
    'if ! command -v curl >/dev/null 2>&1; then',
    '  echo "curl is not available in this sandbox."',
    "  exit 1",
    "fi",
    "",
    'body_file="$(mktemp)"',
    'curl_args=(-sS -o "${body_file}" -w "%{http_code}")',
    'if [[ -n "${api_key}" ]]; then',
    '  header_value="${api_key}"',
    '  if [[ "${header_name}" == "Authorization" && -n "${auth_scheme}" ]]; then',
    '    header_value="${auth_scheme} ${api_key}"',
    "  fi",
    '  curl_args+=(-H "${header_name}: ${header_value}")',
    "fi",
    'status_code="$(curl "${curl_args[@]}" "${request_url}")"',
    'echo "Request URL: ${request_url}"',
    'if [[ -n "${api_key}" ]]; then',
    '  echo "Header name: ${header_name}"',
    "else",
    '  echo "Header name: none"',
    "fi",
    'echo "HTTP status: ${status_code}"',
    'echo "Response preview:"',
    'head -c 800 "${body_file}"',
    'printf "\\n"',
    'rm -f "${body_file}"',
    "",
  ].join("\n");
}

function buildAllScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'template_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'echo "Running validation template checks..."',
    '"${template_dir}/verify-runtime.sh"',
    '"${template_dir}/verify-env.sh"',
    'if [[ -n "${VALIDATION_REQUEST_URL:-}" ]]; then',
    '  echo "Running outbound request verification..."',
    '  "${template_dir}/verify-request.sh"',
    "else",
    '  echo "Skipping outbound request verification because VALIDATION_REQUEST_URL is not set."',
    "fi",
    "",
  ].join("\n");
}

async function bootstrapValidationTemplate(
  sandbox: Sandbox,
  context: {
    runtime: RuntimeName;
    environment: Record<string, string>;
  }
): Promise<void> {
  const manifest = buildValidationManifest(context.environment);
  await sandbox.writeFiles([
    {
      path: `${VALIDATION_TEMPLATE_DIR}/README.md`,
      content: Buffer.from(buildValidationReadme()),
    },
    {
      path: `${VALIDATION_TEMPLATE_DIR}/env-keys.txt`,
      content: Buffer.from(manifest),
    },
    {
      path: `${VALIDATION_TEMPLATE_DIR}/verify-runtime.sh`,
      content: Buffer.from(buildRuntimeScript()),
    },
    {
      path: `${VALIDATION_TEMPLATE_DIR}/verify-env.sh`,
      content: Buffer.from(buildEnvironmentScript()),
    },
    {
      path: `${VALIDATION_TEMPLATE_DIR}/verify-request.sh`,
      content: Buffer.from(buildRequestScript()),
    },
    {
      path: `${VALIDATION_TEMPLATE_DIR}/verify-all.sh`,
      content: Buffer.from(buildAllScript()),
    },
  ]);

  const chmodResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      `chmod +x ${VALIDATION_TEMPLATE_DIR}/verify-runtime.sh ${VALIDATION_TEMPLATE_DIR}/verify-env.sh ${VALIDATION_TEMPLATE_DIR}/verify-request.sh ${VALIDATION_TEMPLATE_DIR}/verify-all.sh`,
    ],
  });

  if (chmodResult.exitCode !== 0) {
    throw new Error("Failed to finalize validation template scripts.");
  }
}

function buildValidationPrompt(args: {
  prompt: string;
  environment: Record<string, string>;
}): string {
  const envKeys = Object.keys(args.environment).sort();
  const userPrompt =
    args.prompt.trim() ||
    "Run ./sandcastle-template/verify-all.sh, explain what passed, and call out any missing environment variables or outbound request requirements.";

  const lines = [
    "This sandbox was created from the Sandcastle Shell Scripts Validation template.",
    "Validation scripts are available in /vercel/sandbox/sandcastle-template.",
    "Use the scripts to verify template boot, filesystem setup, launch environment variables, and authenticated outbound requests when configured.",
    "If VALIDATION_REQUEST_URL is present, verify-request.sh should call it even when no API key is configured.",
    "",
    "Available scripts:",
    "- ./sandcastle-template/verify-runtime.sh",
    "- ./sandcastle-template/verify-env.sh",
    "- ./sandcastle-template/verify-request.sh",
    "- ./sandcastle-template/verify-all.sh",
    "",
    envKeys.length > 0
      ? `Launch environment variables available to the sandbox: ${envKeys.join(", ")}.`
      : "No launch environment variables were configured for this sandbox.",
    "",
    `User request: ${userPrompt}`,
  ];

  return lines.join("\n");
}

async function bootstrapWebpageInspectorTemplate(
  sandbox: Sandbox,
  context: {
    runtime: RuntimeName;
    environment: Record<string, string>;
  }
): Promise<void> {
  const manifest = buildEnvironmentManifest(context.environment);
  await sandbox.writeFiles([
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/README.md`,
      content: Buffer.from(buildWebpageInspectorReadme()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/env-keys.txt`,
      content: Buffer.from(manifest),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/page-audit-lib.mjs`,
      content: Buffer.from(buildWebpageInspectorLibrary()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/page-inspector.mjs`,
      content: Buffer.from(buildWebpageInspectorCli()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/inspect-page.sh`,
      content: Buffer.from(buildWebpageInspectorScript()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/serve-report.sh`,
      content: Buffer.from(buildWebpageInspectorServeScript()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/show-summary.sh`,
      content: Buffer.from(buildWebpageInspectorShowSummaryScript()),
    },
    {
      path: `${WEBPAGE_INSPECTOR_OUTPUT_DIR}/latest-summary.txt`,
      content: Buffer.from(
        "No webpage report has been generated yet. Run ./sandcastle-template/inspect-page.sh <url> first.\n"
      ),
    },
    {
      path: `${WEBPAGE_INSPECTOR_REPORT_DIR}/index.html`,
      content: Buffer.from(buildWebpageInspectorPlaceholderReport()),
    },
  ]);

  const chmodResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      `chmod +x ${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/inspect-page.sh ${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/serve-report.sh ${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/show-summary.sh`,
    ],
  });

  if (chmodResult.exitCode !== 0) {
    throw new Error("Failed to finalize webpage inspector template scripts.");
  }

  await sandbox.runCommand({
    cmd: "python3",
    args: [
      "-m",
      "http.server",
      String(WEBPAGE_INSPECTOR_PORT),
      "--directory",
      WEBPAGE_INSPECTOR_REPORT_DIR,
      "--bind",
      "0.0.0.0",
    ],
    detached: true,
  } as never);
}

function buildWebpageInspectorPrompt(args: {
  prompt: string;
  environment: Record<string, string>;
}): string {
  const envKeys = Object.keys(args.environment).sort();

  return [
    "This sandbox was created from the Sandcastle Webpage Inspector template.",
    "A live HTML report server is already running from /vercel/sandbox/sandcastle-template/report-site on port 4173.",
    "Use the template helpers instead of inventing the workflow from scratch.",
    "",
    "Required workflow:",
    "1. Extract the primary http or https URL from the user's request.",
    "2. Run ./sandcastle-template/inspect-page.sh \"<url>\" \"<focus notes>\" to generate a full report.",
    "3. Review ./sandcastle-template/show-summary.sh and the JSON report at /vercel/sandbox/sandcastle-template/output/latest-report.json.",
    "4. Keep the HTML report updated in /vercel/sandbox/sandcastle-template/report-site/index.html.",
    "5. If the preview server is not live, restart it with ./sandcastle-template/serve-report.sh.",
    "",
    "Available helpers:",
    "- ./sandcastle-template/inspect-page.sh",
    "- ./sandcastle-template/show-summary.sh",
    "- ./sandcastle-template/serve-report.sh",
    "- /vercel/sandbox/sandcastle-template/page-audit-lib.mjs",
    "",
    envKeys.length > 0
      ? `Launch environment variables available to the sandbox: ${envKeys.join(", ")}. Never print secret values directly.`
      : "No launch environment variables were configured for this sandbox.",
    "",
    "When you respond, summarize the highest-signal diagnostics and mention that the rendered HTML report is available via the sandbox preview URL.",
    "",
    `User request: ${args.prompt.trim()}`,
  ].join("\n");
}

export const sandcastleTemplates: SandcastleTemplateDefinition[] = [
  {
    slug: "claude-code",
    name: "Claude Code",
    status: "live",
    summary:
      "A clean, human-first coding template with stable request/result artifacts for Sandcastle tasks.",
    purpose:
      "General coding, app work, debugging, refactors, and collaborative tasks where the user wants Claude Code-style behavior with light structure.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24", "node22"],
    executionStrategy: { kind: "claude-agent" },
    launchLabel: "Launch Claude Code",
    ports: DEFAULT_TEMPLATE_PORTS,
    timeoutMs: ms("30m"),
    vcpus: 4,
    promptPlaceholder:
      "Describe the coding work to perform. You may optionally include a ```sandcastle-request JSON block for structured inputs.",
    defaultPrompt:
      "Inspect the workspace, carry out the requested coding task, and keep request/result artifacts up to date.",
    envHints: [
      {
        key: "ANTHROPIC_MODEL",
        label: "Anthropic model",
        description: "Select which Claude model powers this run.",
        defaultValue: DEFAULT_CLAUDE_MODEL,
        inputType: "select",
        options: CLAUDE_MODEL_OPTIONS,
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        description:
          "Optional. Overrides the platform default Anthropic key for this sandbox.",
        secret: true,
      },
    ],
    bootstrap: async (sandbox, context) =>
      bootstrapProviderTemplate("claude-code", sandbox, context),
    buildInitialPrompt: buildClaudeCodePrompt,
  },
  {
    slug: "codex",
    name: "Codex",
    status: "live",
    summary:
      "An OpenAI-backed coding template with stable request/result artifacts for Sandcastle tasks.",
    purpose:
      "General coding, app work, debugging, and structured OpenAI-based tasks where the user wants Codex-style behavior.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24", "node22"],
    executionStrategy: { kind: "codex-agent" },
    launchLabel: "Launch Codex",
    ports: DEFAULT_TEMPLATE_PORTS,
    timeoutMs: ms("30m"),
    vcpus: 4,
    promptPlaceholder:
      "Describe the coding work to perform. For advanced integrations, include a ```sandcastle-request JSON block.",
    defaultPrompt:
      "Materialize the structured request, carry out the requested work, and write deterministic result artifacts before finishing.",
    envHints: [
      {
        key: "OPENAI_MODEL",
        label: "OpenAI model",
        description: "Select which OpenAI coding model powers this run.",
        defaultValue: DEFAULT_OPENAI_MODEL,
        inputType: "select",
        options: OPENAI_MODEL_OPTIONS,
      },
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API key",
        description:
          "Optional. Overrides the platform default OpenAI key for this sandbox.",
        secret: true,
      },
    ],
    bootstrap: async (sandbox, context) =>
      bootstrapProviderTemplate("codex", sandbox, context),
    buildInitialPrompt: buildCodexPrompt,
  },
  {
    slug: "website-deep-dive",
    name: "Website Deep Dive",
    status: "live",
    summary:
      "A Claude Code-based research template for understanding a website's product, positioning, UX, and technical signals.",
    purpose:
      "Website teardown work, product understanding, competitive research, and technical reconnaissance from a live site or URL set.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24", "node22"],
    executionStrategy: { kind: "claude-agent" },
    launchLabel: "Launch deep dive",
    ports: DEFAULT_TEMPLATE_PORTS,
    timeoutMs: ms("30m"),
    vcpus: 4,
    promptPlaceholder:
      "Give the target website and what you want to learn. Example: deep dive https://example.com and tell me what the product does, how the site is structured, and what tech it appears to use.",
    defaultPrompt:
      "Deep dive the target website from the user request and summarize what the company does, who it serves, how the site is structured, and what technical or UX signals stand out.",
    envHints: [
      {
        key: "ANTHROPIC_MODEL",
        label: "Anthropic model",
        description: "Select which Claude model powers this deep dive.",
        defaultValue: DEFAULT_CLAUDE_MODEL,
        inputType: "select",
        options: CLAUDE_MODEL_OPTIONS,
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        description:
          "Optional. Overrides the platform default Anthropic key for this sandbox.",
        secret: true,
      },
      {
        key: "WEBSITE_AUTH_TOKEN",
        label: "Website auth token",
        description:
          "Optional token for authenticated sites, previews, or staging environments.",
      },
      {
        key: "WEBSITE_AUTH_HEADER_NAME",
        label: "Auth header name",
        description:
          "Optional. Defaults to Authorization when manually building authenticated requests.",
      },
      {
        key: "WEBSITE_AUTH_SCHEME",
        label: "Auth scheme",
        description:
          "Optional. Defaults to Bearer when using Authorization.",
      },
    ],
    bootstrap: async (sandbox, context) =>
      bootstrapProviderTemplate("claude-code", sandbox, context),
    buildInitialPrompt: buildWebsiteDeepDivePrompt,
  },
  {
    slug: "wordcount",
    name: "Wordcount",
    status: "live",
    summary:
      "A shell-command template that counts words in prompt text using a selectable counting method.",
    purpose:
      "Exercise prompt-capable shell-command execution and config-driven select inputs against raw text without involving an AI agent.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24"],
    executionStrategy: {
      kind: "shell-command",
      cmd: "bash",
      args: ["-lc", WORDCOUNT_TEMPLATE_COMMAND],
      cwd: "/vercel/sandbox",
      promptMode: "env",
      promptEnvKey: "WORDCOUNT_TEXT",
    },
    launchLabel: "Run wordcount",
    ports: [],
    timeoutMs: ms("10m"),
    vcpus: 2,
    promptPlaceholder:
      `Enter the text to count. Defaults to "${DEFAULT_WORDCOUNT_TEXT}".`,
    defaultPrompt: DEFAULT_WORDCOUNT_TEXT,
    envHints: [
      {
        key: "WORDCOUNT_METHOD",
        label: "Counting method",
        description: "Select how the shell command should count words.",
        defaultValue: DEFAULT_WORDCOUNT_METHOD,
        inputType: "select",
        options: WORDCOUNT_METHOD_OPTIONS,
      },
    ],
    bootstrap: bootstrapWordcountTemplate,
    buildInitialPrompt: ({ prompt }) => prompt.trim(),
  },
];

export function getSandcastleTemplate(
  slug: string
): SandcastleTemplateDefinition | null {
  return sandcastleTemplates.find((template) => template.slug === slug) ?? null;
}

export function listSandcastleTemplateCatalog(): SandcastleTemplateCatalogEntry[] {
  return sandcastleTemplates.map((template) => ({
    slug: template.slug,
    name: template.name,
    status: template.status,
    summary: template.summary,
    purpose: template.purpose,
    sourceKind: template.source.kind,
    defaultRuntime: template.defaultRuntime,
    supportedRuntimes: [...template.supportedRuntimes],
    executionStrategyKind: template.executionStrategy.kind,
    acceptsPrompts: executionStrategyAcceptsPrompts(template.executionStrategy),
    launchLabel: template.launchLabel,
    ports: [...template.ports],
    timeoutMs: template.timeoutMs,
    vcpus: template.vcpus,
    promptPlaceholder: template.promptPlaceholder,
    defaultPrompt: template.defaultPrompt,
    envHints: template.envHints.map((hint) => ({
      ...hint,
      options: hint.options?.map((option) => ({ ...option })),
    })),
  }));
}

export function listSandcastleTemplateSummaries(): TemplateSummary[] {
  return sandcastleTemplates.map((template) => ({
    slug: template.slug,
    ownerType: "system",
    name: template.name,
    summary: template.summary,
    purpose: template.purpose,
    status: template.status,
    sourceKind: template.source.kind,
    defaultRuntime: template.defaultRuntime,
    supportedRuntimes: [...template.supportedRuntimes],
    launchLabel: template.launchLabel,
  }));
}

export function getCreatableSandcastleTemplate(
  slug: string
): SandcastleTemplateDefinition | null {
  const template = getSandcastleTemplate(slug);
  if (!template || template.status !== "live") {
    return null;
  }
  return template;
}

export function assertTemplateConfiguration(): void {
  const seen = new Set<string>();

  for (const template of sandcastleTemplates) {
    if (!template.slug.trim()) {
      throw new Error("Found a template with an empty slug.");
    }

    if (seen.has(template.slug)) {
      throw new Error(`Template slug '${template.slug}' is defined more than once.`);
    }
    seen.add(template.slug);

    if (!template.supportedRuntimes.includes(template.defaultRuntime)) {
      throw new Error(
        `Template '${template.slug}' has default runtime '${template.defaultRuntime}' outside its supported runtime list.`
      );
    }

    if (!template.launchLabel.trim()) {
      throw new Error(`Template '${template.slug}' is missing a launch label.`);
    }

    if (!template.promptPlaceholder.trim()) {
      throw new Error(
        `Template '${template.slug}' is missing a prompt placeholder.`
      );
    }
  }

  const defaultTemplate = getCreatableSandcastleTemplate(DEFAULT_TEMPLATE_SLUG);
  if (!defaultTemplate) {
    throw new Error(
      `Default template '${DEFAULT_TEMPLATE_SLUG}' must exist and be live.`
    );
  }
}

export function listTemplateConfigurationWarnings(): string[] {
  return sandcastleTemplates.flatMap((template) => {
    if (
      template.source.kind === "snapshot" &&
      !process.env[template.source.snapshotEnvVar]
    ) {
      return [
        `Template '${template.slug}' is snapshot-backed but ${template.source.snapshotEnvVar} is not set. Sandcastle will fall back to runtime-based sandbox creation.`,
      ];
    }

    return [];
  });
}

export function summarizeTemplateRuntimes(
  template: Pick<SandcastleTemplateDefinition, "supportedRuntimes">
): string {
  return template.supportedRuntimes
    .map((runtime) => {
      switch (runtime) {
        case "node24":
          return "Node 24";
        case "node22":
          return "Node 22";
        default:
          return "Python 3.13";
      }
    })
    .join(", ");
}

export function resolveTemplatePrompt(
  template: SandcastleTemplateDefinition,
  prompt: string,
  environment: Record<string, string>
): string {
  const acceptsPrompts = executionStrategyAcceptsPrompts(
    template.executionStrategy
  );
  if (!acceptsPrompts) {
    return "";
  }

  const resolvedPrompt = prompt.trim() || (template.defaultPrompt ?? "");
  if (!resolvedPrompt) {
    throw new Error(`Template '${template.name}' requires an initial prompt.`);
  }

  if (template.executionStrategy.kind === "shell-command") {
    return resolvedPrompt;
  }

  return template.buildInitialPrompt({
    prompt: resolvedPrompt,
    environment,
  });
}

export function resolveTemplateEnvironment(
  template: SandcastleTemplateDefinition,
  environment: Record<string, string>,
  defaults: TemplateEnvironmentDefaults = {}
): Record<string, string> {
  void defaults;
  const resolved = { ...environment };

  for (const field of template.envHints) {
    const currentValue = resolved[field.key];
    if (
      (!currentValue || !currentValue.trim()) &&
      typeof field.defaultValue === "string" &&
      field.defaultValue.trim()
    ) {
      resolved[field.key] = field.defaultValue;
    }
  }

  return applyExecutionStrategyEnvironmentDefaults(
    template.executionStrategy,
    resolved
  );
}
