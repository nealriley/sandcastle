import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
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

const DEFAULT_TEMPLATE_PORTS = [3000, 5173, 8888];
const VALIDATION_TEMPLATE_DIR = "/vercel/sandbox/sandcastle-template";

export type SandcastleTemplateStatus = "live" | "planned";

export interface SandcastleTemplateEnvHint {
  key: string;
  label: string;
  description: string;
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
  "bootstrap" | "buildInitialPrompt" | "source"
> & {
  sourceKind: SandcastleTemplateSource["kind"];
};

export interface TemplateEnvironmentDefaults {
  templateValidationUrl?: string;
}

export const DEFAULT_TEMPLATE_SLUG = "standard";

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
    slug: "standard",
    name: "Standard",
    status: "live",
    summary:
      "The default Sandcastle coding environment used for previews, installs, and iterative agent work.",
    purpose:
      "General-purpose coding, preview servers, dependency installs, and follow-up prompts.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24", "node22", "python3.13"],
    launchLabel: "Create sandbox",
    ports: DEFAULT_TEMPLATE_PORTS,
    timeoutMs: ms("30m"),
    vcpus: 4,
    promptPlaceholder:
      "Describe what this sandbox should do first. Example: scaffold a Next.js app and start the dev server.",
    envHints: [],
    bootstrap: noOpBootstrap,
    buildInitialPrompt: ({ prompt }) => prompt.trim(),
  },
  {
    slug: "shell-scripts-validation",
    name: "Shell Scripts Validation",
    status: "live",
    summary:
      "A validation sandbox that ships shell scripts proving template boot, environment injection, and request wiring are working correctly.",
    purpose:
      "Release validation, template smoke checks, and proving that launch-time API keys are usable inside the sandbox.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24"],
    launchLabel: "Run validation template",
    ports: [],
    timeoutMs: ms("20m"),
    vcpus: 2,
    promptPlaceholder:
      "Optional. Leave blank to run the built-in validation flow, or add extra checks you want the sandbox to perform.",
    defaultPrompt:
      "Run the validation scripts and summarize whether template setup, environment injection, and outbound request support are working.",
    envHints: [
      {
        key: "VALIDATION_REQUEST_URL",
        label: "Validation request URL",
        description:
          "Optional. Defaults to Sandcastle's own /api/template-validation endpoint.",
      },
      {
        key: "VALIDATION_API_KEY",
        label: "Validation API key",
        description:
          "Optional bearer or raw API key used by verify-request.sh.",
      },
      {
        key: "VALIDATION_AUTH_HEADER_NAME",
        label: "Auth header name",
        description:
          "Optional. Defaults to Authorization.",
      },
      {
        key: "VALIDATION_AUTH_SCHEME",
        label: "Auth scheme",
        description:
          "Optional. Defaults to Bearer when using Authorization.",
      },
    ],
    bootstrap: bootstrapValidationTemplate,
    buildInitialPrompt: buildValidationPrompt,
  },
  {
    slug: "webpage-inspector",
    name: "Webpage Inspector",
    status: "live",
    summary:
      "Inspects a user-provided webpage URL, runs structural diagnostics, and renders a live HTML report in the sandbox preview.",
    purpose:
      "Webpage audits, content inspection, SEO and metadata checks, header diagnostics, and browser-deliverable HTML reports for SHGO workflows.",
    source: {
      kind: "snapshot",
      snapshotEnvVar: "BASE_SNAPSHOT_ID",
      snapshotRuntime: "node24",
    },
    defaultRuntime: "node24",
    supportedRuntimes: ["node24"],
    launchLabel: "Inspect webpage",
    ports: [WEBPAGE_INSPECTOR_PORT],
    timeoutMs: ms("20m"),
    vcpus: 2,
    promptPlaceholder:
      "Provide the target URL and what you want inspected. Example: inspect https://example.com and focus on metadata, headings, and security headers.",
    defaultPrompt:
      "Inspect the target webpage URL from the user request, generate the HTML report, and summarize the most important diagnostics.",
    envHints: [
      {
        key: "PAGE_AUDIT_AUTH_TOKEN",
        label: "Page auth token",
        description:
          "Optional token for authenticated pages or internal staging URLs.",
      },
      {
        key: "PAGE_AUDIT_AUTH_HEADER_NAME",
        label: "Auth header name",
        description:
          "Optional. Defaults to Authorization.",
      },
      {
        key: "PAGE_AUDIT_AUTH_SCHEME",
        label: "Auth scheme",
        description:
          "Optional. Defaults to Bearer when using Authorization.",
      },
    ],
    bootstrap: bootstrapWebpageInspectorTemplate,
    buildInitialPrompt: buildWebpageInspectorPrompt,
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
    launchLabel: template.launchLabel,
    ports: [...template.ports],
    timeoutMs: template.timeoutMs,
    vcpus: template.vcpus,
    promptPlaceholder: template.promptPlaceholder,
    defaultPrompt: template.defaultPrompt,
    envHints: template.envHints.map((hint) => ({ ...hint })),
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
  const resolvedPrompt = prompt.trim() || (template.defaultPrompt ?? "");
  if (!resolvedPrompt) {
    throw new Error(`Template '${template.name}' requires an initial prompt.`);
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
  const resolved = { ...environment };

  if (
    template.slug === "shell-scripts-validation" &&
    !resolved.VALIDATION_REQUEST_URL &&
    defaults.templateValidationUrl
  ) {
    resolved.VALIDATION_REQUEST_URL = defaults.templateValidationUrl;
  }

  return resolved;
}
