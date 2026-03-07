import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import {
  DEFAULT_TEMPLATE_SLUG,
  getSandcastleTemplate,
  listSandcastleTemplateCatalog,
  type SandcastleTemplateDefinition,
} from "./templates";
import { getRedis } from "./redis";
import type { TemplateSummary } from "./types.js";
import type {
  DeclarativeTemplateSpec,
  LegacyBuiltinTemplateSpec,
  TemplateBootstrapManifest,
  TemplateBootstrapOperation,
  TemplateCatalogEntry,
  TemplateEnvironmentField,
  TemplateLaunchConfig,
  TemplatePromptConfig,
  TemplateRecord,
  TemplateRecordStatus,
  TemplateRuntimeConstraints,
  TemplateServiceListResponse,
  TemplateServiceResolveResponse,
  TemplateServiceTemplateResponse,
  TemplateSourceConfig,
  TemplateVersionRecord,
  TemplateVersionState,
} from "./template-service-types.js";

type TemplateServiceRedis = {
  del(key: string): Promise<number>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  zadd(
    key: string,
    input: { score: number; member: string }
  ): Promise<unknown>;
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<unknown[]>;
};

type CreateUserTemplateArgs = {
  ownerUserId: string;
  slug: string;
  name: string;
  summary: string;
  purpose: string;
  launchLabel?: string;
  spec?: unknown;
};

type UpdateUserTemplateArgs = {
  slug?: string;
  name?: string;
  summary?: string;
  purpose?: string;
  launchLabel?: string;
  status?: TemplateRecordStatus;
};

type UpdateTemplateVersionArgs = {
  spec?: unknown;
  changelog?: string | null;
};

const MAX_USER_TEMPLATES = 50;
const MAX_TEMPLATE_VERSIONS = 20;
const MAX_ENV_FIELDS = 16;
const MAX_BOOTSTRAP_OPERATIONS = 64;
const MAX_FILE_CONTENT_LENGTH = 100_000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_VCPUS = 2;
const DEFAULT_PORTS = [3000];

export class TemplateServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TemplateServiceError";
    this.status = status;
  }
}

function now(): number {
  return Date.now();
}

function templateRecordKey(templateId: string): string {
  return `template:record:${templateId}`;
}

function templateVersionKey(versionId: string): string {
  return `template:version:${versionId}`;
}

function userTemplateSlugKey(userId: string, slug: string): string {
  return `template:slug:user:${userId}:${slug}`;
}

function userTemplatesKey(userId: string): string {
  return `template:user:${userId}`;
}

function templateVersionsKey(templateId: string): string {
  return `template:versions:${templateId}`;
}

function systemTemplateId(slug: string): string {
  return `tpl_system_${slug}`;
}

function systemTemplateVersionId(slug: string): string {
  return `tplv_system_${slug}_1`;
}

function userTemplateId(): string {
  return `tpl_${randomUUID()}`;
}

function userTemplateVersionId(): string {
  return `tplv_${randomUUID()}`;
}

function inferSecretField(key: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key);
}

function isSandboxPath(path: string): boolean {
  return path === "/vercel/sandbox" || path.startsWith("/vercel/sandbox/");
}

function normalizeSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new TemplateServiceError(
      400,
      "Template slugs must contain lowercase letters, numbers, and hyphens only."
    );
  }

  return slug;
}

function requireString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new TemplateServiceError(400, `${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new TemplateServiceError(400, `${field} is required.`);
  }

  if (trimmed.length > maxLength) {
    throw new TemplateServiceError(
      400,
      `${field} exceeds the maximum length of ${maxLength} characters.`
    );
  }

  return trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TemplateServiceError(400, `${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new TemplateServiceError(
      400,
      `${field} exceeds the maximum length of ${maxLength} characters.`
    );
  }

  return trimmed;
}

function parseRuntime(value: unknown): "node24" | "node22" | "python3.13" {
  if (value === "node24" || value === "node22" || value === "python3.13") {
    return value;
  }

  throw new TemplateServiceError(
    400,
    "Runtime values must be one of: node24, node22, python3.13."
  );
}

function normalizeSourceConfig(input: unknown): TemplateSourceConfig {
  if (!input || typeof input !== "object") {
    return { kind: "runtime" };
  }

  const kind = (input as { kind?: unknown }).kind;
  if (kind == null || kind === "runtime") {
    return { kind: "runtime" };
  }

  throw new TemplateServiceError(
    400,
    "Only runtime-based user templates are supported in the first cut."
  );
}

function normalizeRuntimeConstraints(
  input: unknown
): TemplateRuntimeConstraints {
  if (!input || typeof input !== "object") {
    return {
      defaultRuntime: "node24",
      supportedRuntimes: ["node24"],
    };
  }

  const defaultRuntime = parseRuntime(
    (input as { defaultRuntime?: unknown }).defaultRuntime ?? "node24"
  );
  const supportedRaw =
    (input as { supportedRuntimes?: unknown }).supportedRuntimes ?? [defaultRuntime];

  if (!Array.isArray(supportedRaw) || supportedRaw.length === 0) {
    throw new TemplateServiceError(
      400,
      "supportedRuntimes must contain at least one runtime."
    );
  }

  const supportedRuntimes = [...new Set(supportedRaw.map(parseRuntime))];
  if (!supportedRuntimes.includes(defaultRuntime)) {
    throw new TemplateServiceError(
      400,
      "defaultRuntime must also be present in supportedRuntimes."
    );
  }

  return {
    defaultRuntime,
    supportedRuntimes,
  };
}

function normalizeLaunchConfig(input: unknown): TemplateLaunchConfig {
  if (!input || typeof input !== "object") {
    return {
      ports: [...DEFAULT_PORTS],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      vcpus: DEFAULT_VCPUS,
    };
  }

  const portsRaw = (input as { ports?: unknown }).ports ?? DEFAULT_PORTS;
  if (!Array.isArray(portsRaw) || portsRaw.length > 4) {
    throw new TemplateServiceError(
      400,
      "launchConfig.ports must be an array containing up to 4 ports."
    );
  }

  const ports = portsRaw.map((port) => {
    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new TemplateServiceError(
        400,
        "launchConfig.ports must contain integer port numbers between 1 and 65535."
      );
    }

    return port;
  });

  const timeoutMs =
    (input as { timeoutMs?: unknown }).timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 30_000 ||
    timeoutMs > 60 * 60 * 1000
  ) {
    throw new TemplateServiceError(
      400,
      "launchConfig.timeoutMs must be between 30000 and 3600000."
    );
  }

  const vcpus = (input as { vcpus?: unknown }).vcpus ?? DEFAULT_VCPUS;
  if (
    typeof vcpus !== "number" ||
    !Number.isInteger(vcpus) ||
    vcpus < 1 ||
    vcpus > 8
  ) {
    throw new TemplateServiceError(
      400,
      "launchConfig.vcpus must be an integer between 1 and 8."
    );
  }

  return {
    ports,
    timeoutMs,
    vcpus,
  };
}

function normalizeEnvironmentSchema(input: unknown): TemplateEnvironmentField[] {
  if (input == null) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new TemplateServiceError(
      400,
      "environmentSchema must be an array."
    );
  }

  if (input.length > MAX_ENV_FIELDS) {
    throw new TemplateServiceError(
      400,
      `environmentSchema may contain at most ${MAX_ENV_FIELDS} fields.`
    );
  }

  const seen = new Set<string>();

  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new TemplateServiceError(
        400,
        `environmentSchema[${index}] must be an object.`
      );
    }

    const key = requireString(
      (raw as { key?: unknown }).key,
      `environmentSchema[${index}].key`,
      64
    ).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new TemplateServiceError(
        400,
        `environmentSchema[${index}].key must be uppercase snake case.`
      );
    }

    if (seen.has(key)) {
      throw new TemplateServiceError(
        400,
        `environmentSchema contains duplicate key '${key}'.`
      );
    }
    seen.add(key);

    return {
      key,
      label: requireString(
        (raw as { label?: unknown }).label ?? key,
        `environmentSchema[${index}].label`,
        80
      ),
      description: requireString(
        (raw as { description?: unknown }).description ?? key,
        `environmentSchema[${index}].description`,
        240
      ),
      required: Boolean((raw as { required?: unknown }).required),
      secret:
        typeof (raw as { secret?: unknown }).secret === "boolean"
          ? Boolean((raw as { secret?: unknown }).secret)
          : inferSecretField(key),
      defaultValue: optionalString(
        (raw as { defaultValue?: unknown }).defaultValue,
        `environmentSchema[${index}].defaultValue`,
        4000
      ),
    };
  });
}

function normalizePromptConfig(input: unknown): TemplatePromptConfig {
  if (!input || typeof input !== "object") {
    return {
      promptPlaceholder:
        "Describe what this template should set up before sandbox work begins.",
      defaultPrompt: null,
      initialPromptTemplate: "{{prompt}}",
      followUpHint: null,
    };
  }

  return {
    promptPlaceholder: requireString(
      (input as { promptPlaceholder?: unknown }).promptPlaceholder ??
        "Describe what this template should set up before sandbox work begins.",
      "promptConfig.promptPlaceholder",
      400
    ),
    defaultPrompt: optionalString(
      (input as { defaultPrompt?: unknown }).defaultPrompt,
      "promptConfig.defaultPrompt",
      10_000
    ),
    initialPromptTemplate: optionalString(
      (input as { initialPromptTemplate?: unknown }).initialPromptTemplate ??
        "{{prompt}}",
      "promptConfig.initialPromptTemplate",
      20_000
    ),
    followUpHint: optionalString(
      (input as { followUpHint?: unknown }).followUpHint,
      "promptConfig.followUpHint",
      1000
    ),
  };
}

function normalizeBootstrapOperation(
  raw: unknown,
  index: number
): TemplateBootstrapOperation {
  if (!raw || typeof raw !== "object") {
    throw new TemplateServiceError(
      400,
      `bootstrapManifest.operations[${index}] must be an object.`
    );
  }

  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "write_file") {
    const path = requireString(
      (raw as { path?: unknown }).path,
      `bootstrapManifest.operations[${index}].path`,
      240
    );

    if (!isSandboxPath(path)) {
      throw new TemplateServiceError(
        400,
        "write_file operations must target /vercel/sandbox/ paths."
      );
    }

    const content = requireString(
      (raw as { content?: unknown }).content,
      `bootstrapManifest.operations[${index}].content`,
      MAX_FILE_CONTENT_LENGTH
    );

    return {
      kind,
      path,
      content,
      executable: Boolean((raw as { executable?: unknown }).executable),
    };
  }

  if (kind === "run_command") {
    const cmd = requireString(
      (raw as { cmd?: unknown }).cmd,
      `bootstrapManifest.operations[${index}].cmd`,
      160
    );
    const argsRaw = (raw as { args?: unknown }).args ?? [];
    if (!Array.isArray(argsRaw) || argsRaw.some((value) => typeof value !== "string")) {
      throw new TemplateServiceError(
        400,
        `bootstrapManifest.operations[${index}].args must be a string array.`
      );
    }

    const cwd = optionalString(
      (raw as { cwd?: unknown }).cwd,
      `bootstrapManifest.operations[${index}].cwd`,
      240
    );
    if (cwd && !isSandboxPath(cwd)) {
      throw new TemplateServiceError(
        400,
        "run_command operations may only target /vercel/sandbox/ working directories."
      );
    }

    return {
      kind,
      cmd,
      args: argsRaw as string[],
      cwd,
      detached: Boolean((raw as { detached?: unknown }).detached),
      description: optionalString(
        (raw as { description?: unknown }).description,
        `bootstrapManifest.operations[${index}].description`,
        240
      ),
    };
  }

  throw new TemplateServiceError(
    400,
    `bootstrapManifest.operations[${index}] has unsupported kind '${String(kind)}'.`
  );
}

function normalizeBootstrapManifest(input: unknown): TemplateBootstrapManifest {
  if (!input || typeof input !== "object") {
    return {
      operations: [],
      previewPorts: [...DEFAULT_PORTS],
    };
  }

  const operationsRaw =
    (input as { operations?: unknown }).operations ?? [];
  if (!Array.isArray(operationsRaw)) {
    throw new TemplateServiceError(
      400,
      "bootstrapManifest.operations must be an array."
    );
  }

  if (operationsRaw.length > MAX_BOOTSTRAP_OPERATIONS) {
    throw new TemplateServiceError(
      400,
      `bootstrapManifest may contain at most ${MAX_BOOTSTRAP_OPERATIONS} operations.`
    );
  }

  const previewPortsRaw =
    (input as { previewPorts?: unknown }).previewPorts ?? DEFAULT_PORTS;
  if (
    !Array.isArray(previewPortsRaw) ||
    previewPortsRaw.some(
      (port) =>
        typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
    )
  ) {
    throw new TemplateServiceError(
      400,
      "bootstrapManifest.previewPorts must be an array of valid port numbers."
    );
  }

  return {
    operations: operationsRaw.map(normalizeBootstrapOperation),
    previewPorts: [...new Set(previewPortsRaw as number[])],
  };
}

export function normalizeDeclarativeTemplateSpec(
  input: unknown
): DeclarativeTemplateSpec {
  const raw =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return {
    kind: "declarative",
    source: normalizeSourceConfig(raw.source),
    runtimeConstraints: normalizeRuntimeConstraints(raw.runtimeConstraints),
    launchConfig: normalizeLaunchConfig(raw.launchConfig),
    environmentSchema: normalizeEnvironmentSchema(raw.environmentSchema),
    promptConfig: normalizePromptConfig(raw.promptConfig),
    bootstrapManifest: normalizeBootstrapManifest(raw.bootstrapManifest),
    assetBundleRef: optionalString(
      raw.assetBundleRef,
      "assetBundleRef",
      240
    ),
  };
}

function buildDefaultDeclarativeTemplateSpec(): DeclarativeTemplateSpec {
  return normalizeDeclarativeTemplateSpec({});
}

function toTemplateSummary(entry: TemplateCatalogEntry): TemplateSummary {
  return {
    slug: entry.slug,
    ownerType: entry.ownerType,
    name: entry.name,
    summary: entry.summary,
    purpose: entry.purpose,
    status: entry.templateStatus === "active" ? "live" : "planned",
    sourceKind: entry.sourceKind,
    defaultRuntime: entry.defaultRuntime,
    supportedRuntimes: entry.supportedRuntimes,
    launchLabel: entry.launchLabel,
  };
}

function buildLegacyBuiltinSpec(
  slug: string
): LegacyBuiltinTemplateSpec {
  const template = getSandcastleTemplate(slug);
  if (!template) {
    throw new TemplateServiceError(404, `Unknown system template '${slug}'.`);
  }

  return {
    kind: "legacy_builtin",
    legacyBuiltinSlug: template.slug,
    source: template.source,
    runtimeConstraints: {
      defaultRuntime: template.defaultRuntime,
      supportedRuntimes: [...template.supportedRuntimes],
    },
    launchConfig: {
      ports: [...template.ports],
      timeoutMs: template.timeoutMs,
      vcpus: template.vcpus,
    },
    environmentSchema: template.envHints.map((hint) => ({
      key: hint.key,
      label: hint.label,
      description: hint.description,
      required: false,
      secret: inferSecretField(hint.key),
      defaultValue: null,
    })),
    promptConfig: {
      promptPlaceholder: template.promptPlaceholder,
      defaultPrompt: template.defaultPrompt ?? null,
      initialPromptTemplate: null,
      followUpHint: null,
    },
    assetBundleRef: null,
  };
}

function buildSystemTemplateRecord(
  slug: string
): { template: TemplateRecord; version: TemplateVersionRecord } {
  const template = getSandcastleTemplate(slug);
  if (!template) {
    throw new TemplateServiceError(404, `Unknown system template '${slug}'.`);
  }

  const templateId = systemTemplateId(slug);
  const versionId = systemTemplateVersionId(slug);
  const createdAt = 0;

  return {
    template: {
      id: templateId,
      slug: template.slug,
      ownerType: "system",
      ownerUserId: null,
      name: template.name,
      summary: template.summary,
      purpose: template.purpose,
      launchLabel: template.launchLabel,
      visibility: "system",
      status: template.status === "live" ? "active" : "archived",
      createdAt,
      updatedAt: createdAt,
      latestVersionId: versionId,
      latestPublishedVersionId: versionId,
    },
    version: {
      id: versionId,
      templateId,
      versionNumber: 1,
      state: "published",
      createdBy: null,
      changelog: "Seeded system template.",
      createdAt,
      spec: buildLegacyBuiltinSpec(slug),
    },
  };
}

function buildCatalogEntry(
  template: TemplateRecord,
  version: TemplateVersionRecord
): TemplateCatalogEntry {
  return {
    templateId: template.id,
    slug: template.slug,
    ownerType: template.ownerType,
    ownerUserId: template.ownerUserId,
    name: template.name,
    summary: template.summary,
    purpose: template.purpose,
    launchLabel: template.launchLabel,
    visibility: template.visibility,
    templateStatus: template.status,
    latestVersionId: version.id,
    latestVersionState: version.state,
    sourceKind: version.spec.source.kind,
    defaultRuntime: version.spec.runtimeConstraints.defaultRuntime,
    supportedRuntimes: version.spec.runtimeConstraints.supportedRuntimes,
    promptPlaceholder: version.spec.promptConfig.promptPlaceholder,
    defaultPrompt: version.spec.promptConfig.defaultPrompt,
    environmentSchema: version.spec.environmentSchema.map((field) => ({
      ...field,
    })),
  };
}

function sortedByName(entries: TemplateCatalogEntry[]): TemplateCatalogEntry[] {
  return [...entries].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function isSystemTemplateSlug(slug: string): boolean {
  return Boolean(getSandcastleTemplate(slug));
}

async function listUserTemplateIdsInRedis(
  redis: TemplateServiceRedis,
  userId: string
): Promise<string[]> {
  return (
    ((await redis.zrange(
      userTemplatesKey(userId),
      0,
      MAX_USER_TEMPLATES - 1,
      { rev: true }
    )) as string[] | null) ?? []
  );
}

async function getTemplateRecordInRedis(
  redis: TemplateServiceRedis,
  templateId: string
): Promise<TemplateRecord | null> {
  return redis.get<TemplateRecord>(templateRecordKey(templateId));
}

async function getTemplateVersionInRedis(
  redis: TemplateServiceRedis,
  versionId: string
): Promise<TemplateVersionRecord | null> {
  return redis.get<TemplateVersionRecord>(templateVersionKey(versionId));
}

async function listTemplateVersionsInRedis(
  redis: TemplateServiceRedis,
  templateId: string
): Promise<TemplateVersionRecord[]> {
  const versionIds =
    ((await redis.zrange(
      templateVersionsKey(templateId),
      0,
      MAX_TEMPLATE_VERSIONS - 1,
      { rev: true }
    )) as string[] | null) ?? [];

  if (versionIds.length === 0) {
    return [];
  }

  const versions = await Promise.all(
    versionIds.map((versionId) => getTemplateVersionInRedis(redis, versionId))
  );

  return versions.filter(
    (version): version is TemplateVersionRecord => version != null
  );
}

async function getTemplateDetailInRedis(
  redis: TemplateServiceRedis,
  templateId: string
): Promise<TemplateServiceTemplateResponse | null> {
  if (templateId.startsWith("tpl_system_")) {
    const slug = templateId.replace(/^tpl_system_/, "");
    const record = buildSystemTemplateRecord(slug);
    return {
      template: record.template,
      versions: [record.version],
    };
  }

  const template = await getTemplateRecordInRedis(redis, templateId);
  if (!template) {
    return null;
  }

  const versions = await listTemplateVersionsInRedis(redis, templateId);
  return {
    template,
    versions,
  };
}

async function assertUserOwnsTemplate(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  templateId: string
): Promise<TemplateServiceTemplateResponse> {
  const detail = await getTemplateDetailInRedis(redis, templateId);
  if (!detail || detail.template.ownerType !== "user") {
    throw new TemplateServiceError(404, "Template not found.");
  }

  if (detail.template.ownerUserId !== ownerUserId) {
    throw new TemplateServiceError(404, "Template not found.");
  }

  return detail;
}

async function assertUserOwnsVersion(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  versionId: string
): Promise<{ template: TemplateRecord; version: TemplateVersionRecord }> {
  const version = await getTemplateVersionInRedis(redis, versionId);
  if (!version) {
    throw new TemplateServiceError(404, "Template version not found.");
  }

  const template = await getTemplateRecordInRedis(redis, version.templateId);
  if (!template || template.ownerType !== "user") {
    throw new TemplateServiceError(404, "Template version not found.");
  }

  if (template.ownerUserId !== ownerUserId) {
    throw new TemplateServiceError(404, "Template version not found.");
  }

  return { template, version };
}

export function listSystemTemplateCatalogEntries(): TemplateCatalogEntry[] {
  return sortedByName(
    listSandcastleTemplateCatalog().map((template) => {
      const system = buildSystemTemplateRecord(template.slug);
      return buildCatalogEntry(system.template, system.version);
    })
  );
}

export function listSystemTemplateSummaries(): TemplateSummary[] {
  return listSystemTemplateCatalogEntries().map(toTemplateSummary);
}

function isLaunchableTemplateEntry(entry: TemplateCatalogEntry): boolean {
  return (
    entry.templateStatus === "active" &&
    entry.latestVersionState === "published"
  );
}

export function assertTemplateServiceConfiguration(): void {
  const defaultEntry = listSystemTemplateCatalogEntries().find(
    (entry) => entry.slug === DEFAULT_TEMPLATE_SLUG
  );

  if (!defaultEntry) {
    throw new Error(
      `Default template '${DEFAULT_TEMPLATE_SLUG}' is missing from the template service catalog.`
    );
  }

  if (!isLaunchableTemplateEntry(defaultEntry)) {
    throw new Error(
      `Default template '${DEFAULT_TEMPLATE_SLUG}' must be active and published.`
    );
  }
}

function mapEnvironmentHints(
  environmentSchema: TemplateVersionRecord["spec"]["environmentSchema"]
): SandcastleTemplateDefinition["envHints"] {
  return environmentSchema.map((field) => ({
    key: field.key,
    label: field.label,
    description: field.description,
  }));
}

function renderInitialPromptTemplate(args: {
  template: string | null;
  prompt: string;
  environment: Record<string, string>;
  followUpHint: string | null;
}): string {
  const environmentKeys = Object.keys(args.environment).sort();
  const rendered = (args.template ?? "{{prompt}}")
    .replaceAll("{{prompt}}", args.prompt)
    .replaceAll("{{environment_keys}}", environmentKeys.join(", "))
    .replaceAll(
      "{{environment_json}}",
      JSON.stringify(args.environment, null, 2)
    );

  if (!args.followUpHint) {
    return rendered;
  }

  return `${rendered}\n\nFollow-up hint: ${args.followUpHint}`;
}

async function bootstrapDeclarativeTemplate(
  sandbox: Sandbox,
  spec: DeclarativeTemplateSpec
): Promise<void> {
  const writeOperations = spec.bootstrapManifest.operations.filter(
    (operation): operation is Extract<TemplateBootstrapOperation, { kind: "write_file" }> =>
      operation.kind === "write_file"
  );
  if (writeOperations.length > 0) {
    await sandbox.writeFiles(
      writeOperations.map((operation) => ({
        path: operation.path,
        content: Buffer.from(operation.content),
      }))
    );
  }

  const executablePaths = writeOperations
    .filter((operation) => operation.executable)
    .map((operation) => operation.path);
  if (executablePaths.length > 0) {
    const chmodResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `chmod +x ${executablePaths.join(" ")}`],
    });

    if (chmodResult.exitCode !== 0) {
      throw new Error("Failed to finalize template files.");
    }
  }

  const runOperations = spec.bootstrapManifest.operations.filter(
    (operation): operation is Extract<TemplateBootstrapOperation, { kind: "run_command" }> =>
      operation.kind === "run_command"
  );
  for (const operation of runOperations) {
    const result = await sandbox.runCommand({
      cmd: operation.cmd,
      args: operation.args,
      cwd: operation.cwd ?? undefined,
      detached: operation.detached,
    } as never);

    if (!operation.detached && result.exitCode !== 0) {
      throw new Error(
        operation.description
          ? `Template bootstrap failed: ${operation.description}`
          : "Template bootstrap command failed."
      );
    }
  }
}

function materializeLaunchTemplate(
  resolved: TemplateServiceResolveResponse
): SandcastleTemplateDefinition {
  const { template, version } = resolved;

  if (version.spec.kind === "legacy_builtin") {
    const legacyTemplate = getSandcastleTemplate(version.spec.legacyBuiltinSlug);
    if (!legacyTemplate) {
      throw new TemplateServiceError(
        500,
        `Legacy builtin template '${version.spec.legacyBuiltinSlug}' is not available.`
      );
    }

    return legacyTemplate;
  }

  const spec = version.spec;
  return {
    slug: template.slug,
    name: template.name,
    status: template.status === "active" ? "live" : "planned",
    summary: template.summary,
    purpose: template.purpose,
    source: spec.source,
    defaultRuntime: spec.runtimeConstraints.defaultRuntime,
    supportedRuntimes: [...spec.runtimeConstraints.supportedRuntimes],
    launchLabel: template.launchLabel,
    ports: [...spec.launchConfig.ports],
    timeoutMs: spec.launchConfig.timeoutMs,
    vcpus: spec.launchConfig.vcpus,
    promptPlaceholder: spec.promptConfig.promptPlaceholder,
    defaultPrompt: spec.promptConfig.defaultPrompt ?? undefined,
    envHints: mapEnvironmentHints(spec.environmentSchema),
    bootstrap: async (sandbox) => bootstrapDeclarativeTemplate(sandbox, spec),
    buildInitialPrompt: ({ prompt, environment }) =>
      renderInitialPromptTemplate({
        template: spec.promptConfig.initialPromptTemplate,
        prompt,
        environment,
        followUpHint: spec.promptConfig.followUpHint,
      }),
  };
}

export function getDefaultTemplateSlug(): string {
  return DEFAULT_TEMPLATE_SLUG;
}

export async function listTemplateCatalog(
  ownerUserId: string | null
): Promise<TemplateServiceListResponse> {
  return listTemplateCatalogInRedis(getRedis(), ownerUserId);
}

export async function listLaunchableTemplateSummaries(
  ownerUserId: string | null
): Promise<TemplateSummary[]> {
  const response = await listTemplateCatalog(ownerUserId);
  return response.templates
    .filter(isLaunchableTemplateEntry)
    .map(toTemplateSummary);
}

export async function listTemplateCatalogInRedis(
  redis: TemplateServiceRedis,
  ownerUserId: string | null
): Promise<TemplateServiceListResponse> {
  const systemEntries = listSystemTemplateCatalogEntries();

  if (!ownerUserId) {
    return {
      templates: systemEntries,
      defaultTemplateSlug: DEFAULT_TEMPLATE_SLUG,
    };
  }

  const userTemplateIds = await listUserTemplateIdsInRedis(redis, ownerUserId);
  const userEntries: TemplateCatalogEntry[] = [];

  for (const templateId of userTemplateIds) {
    const detail = await getTemplateDetailInRedis(redis, templateId);
    if (!detail) {
      continue;
    }

    const version =
      detail.versions.find((candidate) => candidate.id === detail.template.latestVersionId) ??
      detail.versions[0];
    if (!version) {
      continue;
    }

    userEntries.push(buildCatalogEntry(detail.template, version));
  }

  return {
    templates: [...systemEntries, ...sortedByName(userEntries)],
    defaultTemplateSlug: DEFAULT_TEMPLATE_SLUG,
  };
}

export async function getTemplateDetail(
  templateId: string
): Promise<TemplateServiceTemplateResponse | null> {
  return getTemplateDetailInRedis(getRedis(), templateId);
}

export async function createUserTemplate(
  args: CreateUserTemplateArgs
): Promise<TemplateServiceTemplateResponse> {
  return createUserTemplateInRedis(getRedis(), args);
}

export async function createUserTemplateInRedis(
  redis: TemplateServiceRedis,
  args: CreateUserTemplateArgs
): Promise<TemplateServiceTemplateResponse> {
  const slug = normalizeSlug(args.slug);
  if (isSystemTemplateSlug(slug)) {
    throw new TemplateServiceError(
      409,
      `Template slug '${slug}' is reserved by a system template.`
    );
  }

  const existing = await redis.get<string>(userTemplateSlugKey(args.ownerUserId, slug));
  if (existing) {
    throw new TemplateServiceError(
      409,
      `You already own a template with slug '${slug}'.`
    );
  }

  const ownedTemplateIds = await listUserTemplateIdsInRedis(redis, args.ownerUserId);
  if (ownedTemplateIds.length >= MAX_USER_TEMPLATES) {
    throw new TemplateServiceError(
      400,
      `You can own at most ${MAX_USER_TEMPLATES} templates.`
    );
  }

  const createdAt = now();
  const templateId = userTemplateId();
  const versionId = userTemplateVersionId();
  const spec = normalizeDeclarativeTemplateSpec(args.spec);

  const template: TemplateRecord = {
    id: templateId,
    slug,
    ownerType: "user",
    ownerUserId: args.ownerUserId,
    name: requireString(args.name, "name", 80),
    summary: requireString(args.summary, "summary", 200),
    purpose: requireString(args.purpose, "purpose", 500),
    launchLabel: optionalString(args.launchLabel, "launchLabel", 80) ?? "Create sandbox",
    visibility: "private",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    latestVersionId: versionId,
    latestPublishedVersionId: null,
  };

  const version: TemplateVersionRecord = {
    id: versionId,
    templateId,
    versionNumber: 1,
    state: "draft",
    createdBy: args.ownerUserId,
    changelog: "Initial draft.",
    createdAt,
    spec,
  };

  await redis.set(templateRecordKey(template.id), template);
  await redis.set(templateVersionKey(version.id), version);
  await redis.set(userTemplateSlugKey(args.ownerUserId, slug), template.id);
  await redis.zadd(userTemplatesKey(args.ownerUserId), {
    score: template.updatedAt,
    member: template.id,
  });
  await redis.zadd(templateVersionsKey(template.id), {
    score: version.versionNumber,
    member: version.id,
  });

  return {
    template,
    versions: [version],
  };
}

export async function updateUserTemplate(
  ownerUserId: string,
  templateId: string,
  args: UpdateUserTemplateArgs
): Promise<TemplateServiceTemplateResponse> {
  return updateUserTemplateInRedis(getRedis(), ownerUserId, templateId, args);
}

export async function updateUserTemplateInRedis(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  templateId: string,
  args: UpdateUserTemplateArgs
): Promise<TemplateServiceTemplateResponse> {
  const detail = await assertUserOwnsTemplate(redis, ownerUserId, templateId);
  const current = detail.template;

  const nextSlug =
    args.slug == null ? current.slug : normalizeSlug(args.slug);
  if (nextSlug !== current.slug) {
    if (isSystemTemplateSlug(nextSlug)) {
      throw new TemplateServiceError(
        409,
        `Template slug '${nextSlug}' is reserved by a system template.`
      );
    }

    const existing = await redis.get<string>(
      userTemplateSlugKey(ownerUserId, nextSlug)
    );
    if (existing && existing !== current.id) {
      throw new TemplateServiceError(
        409,
        `You already own a template with slug '${nextSlug}'.`
      );
    }
  }

  const updated: TemplateRecord = {
    ...current,
    slug: nextSlug,
    name:
      args.name == null ? current.name : requireString(args.name, "name", 80),
    summary:
      args.summary == null
        ? current.summary
        : requireString(args.summary, "summary", 200),
    purpose:
      args.purpose == null
        ? current.purpose
        : requireString(args.purpose, "purpose", 500),
    launchLabel:
      args.launchLabel == null
        ? current.launchLabel
        : optionalString(args.launchLabel, "launchLabel", 80) ?? current.launchLabel,
    status: args.status ?? current.status,
    updatedAt: now(),
  };

  await redis.set(templateRecordKey(updated.id), updated);
  if (updated.slug !== current.slug) {
    await redis.del(userTemplateSlugKey(ownerUserId, current.slug));
    await redis.set(userTemplateSlugKey(ownerUserId, updated.slug), updated.id);
  }
  await redis.zadd(userTemplatesKey(ownerUserId), {
    score: updated.updatedAt,
    member: updated.id,
  });

  return {
    template: updated,
    versions: detail.versions,
  };
}

export async function createUserTemplateVersion(
  ownerUserId: string,
  templateId: string
): Promise<TemplateServiceTemplateResponse> {
  return createUserTemplateVersionInRedis(getRedis(), ownerUserId, templateId);
}

export async function createUserTemplateVersionInRedis(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  templateId: string
): Promise<TemplateServiceTemplateResponse> {
  const detail = await assertUserOwnsTemplate(redis, ownerUserId, templateId);
  if (detail.versions.length >= MAX_TEMPLATE_VERSIONS) {
    throw new TemplateServiceError(
      400,
      `Templates may keep at most ${MAX_TEMPLATE_VERSIONS} versions.`
    );
  }

  const latestVersion =
    detail.versions.find((version) => version.id === detail.template.latestVersionId) ??
    detail.versions[0];
  if (!latestVersion) {
    throw new TemplateServiceError(500, "Template has no versions.");
  }

  if (latestVersion.state === "draft") {
    return detail;
  }

  const nextVersionNumber =
    Math.max(...detail.versions.map((version) => version.versionNumber)) + 1;
  const version: TemplateVersionRecord = {
    id: userTemplateVersionId(),
    templateId,
    versionNumber: nextVersionNumber,
    state: "draft",
    createdBy: ownerUserId,
    changelog: null,
    createdAt: now(),
    spec: structuredClone(latestVersion.spec),
  };

  const updatedTemplate: TemplateRecord = {
    ...detail.template,
    latestVersionId: version.id,
    updatedAt: version.createdAt,
  };

  await redis.set(templateVersionKey(version.id), version);
  await redis.zadd(templateVersionsKey(templateId), {
    score: version.versionNumber,
    member: version.id,
  });
  await redis.set(templateRecordKey(templateId), updatedTemplate);
  await redis.zadd(userTemplatesKey(ownerUserId), {
    score: updatedTemplate.updatedAt,
    member: updatedTemplate.id,
  });

  return {
    template: updatedTemplate,
    versions: [version, ...detail.versions],
  };
}

export async function updateUserTemplateVersion(
  ownerUserId: string,
  versionId: string,
  args: UpdateTemplateVersionArgs
): Promise<TemplateServiceTemplateResponse> {
  return updateUserTemplateVersionInRedis(getRedis(), ownerUserId, versionId, args);
}

export async function updateUserTemplateVersionInRedis(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  versionId: string,
  args: UpdateTemplateVersionArgs
): Promise<TemplateServiceTemplateResponse> {
  const { template, version } = await assertUserOwnsVersion(
    redis,
    ownerUserId,
    versionId
  );

  if (version.state !== "draft") {
    throw new TemplateServiceError(
      400,
      "Only draft template versions can be modified."
    );
  }

  const updatedVersion: TemplateVersionRecord = {
    ...version,
    spec:
      args.spec == null ? version.spec : normalizeDeclarativeTemplateSpec(args.spec),
    changelog:
      args.changelog === undefined
        ? version.changelog
        : optionalString(args.changelog, "changelog", 500),
  };

  const updatedTemplate: TemplateRecord = {
    ...template,
    latestVersionId: updatedVersion.id,
    updatedAt: now(),
  };

  await redis.set(templateVersionKey(updatedVersion.id), updatedVersion);
  await redis.set(templateRecordKey(updatedTemplate.id), updatedTemplate);
  await redis.zadd(userTemplatesKey(ownerUserId), {
    score: updatedTemplate.updatedAt,
    member: updatedTemplate.id,
  });

  const versions = await listTemplateVersionsInRedis(redis, template.id);
  return {
    template: updatedTemplate,
    versions,
  };
}

export async function publishUserTemplateVersion(
  ownerUserId: string,
  versionId: string
): Promise<TemplateServiceTemplateResponse> {
  return publishUserTemplateVersionInRedis(getRedis(), ownerUserId, versionId);
}

export async function publishUserTemplateVersionInRedis(
  redis: TemplateServiceRedis,
  ownerUserId: string,
  versionId: string
): Promise<TemplateServiceTemplateResponse> {
  const { template, version } = await assertUserOwnsVersion(
    redis,
    ownerUserId,
    versionId
  );

  if (version.state === "deprecated") {
    throw new TemplateServiceError(
      400,
      "Deprecated template versions cannot be published again."
    );
  }

  let previousPublished: TemplateVersionRecord | null = null;
  if (
    template.latestPublishedVersionId &&
    template.latestPublishedVersionId !== version.id
  ) {
    previousPublished = await getTemplateVersionInRedis(
      redis,
      template.latestPublishedVersionId
    );
  }

  if (previousPublished && previousPublished.state === "published") {
    await redis.set(templateVersionKey(previousPublished.id), {
      ...previousPublished,
      state: "deprecated" as TemplateVersionState,
    });
  }

  const publishedVersion: TemplateVersionRecord = {
    ...version,
    state: "published",
  };
  const updatedTemplate: TemplateRecord = {
    ...template,
    latestVersionId: publishedVersion.id,
    latestPublishedVersionId: publishedVersion.id,
    updatedAt: now(),
  };

  await redis.set(templateVersionKey(publishedVersion.id), publishedVersion);
  await redis.set(templateRecordKey(updatedTemplate.id), updatedTemplate);
  await redis.zadd(userTemplatesKey(ownerUserId), {
    score: updatedTemplate.updatedAt,
    member: updatedTemplate.id,
  });

  const versions = await listTemplateVersionsInRedis(redis, template.id);
  return {
    template: updatedTemplate,
    versions,
  };
}

export async function resolveTemplateBySlug(
  slug: string,
  ownerUserId: string | null
): Promise<TemplateServiceResolveResponse | null> {
  return resolveTemplateBySlugInRedis(getRedis(), slug, ownerUserId);
}

export async function resolveTemplateBySlugInRedis(
  redis: TemplateServiceRedis,
  slug: string,
  ownerUserId: string | null
): Promise<TemplateServiceResolveResponse | null> {
  const normalizedSlug = normalizeSlug(slug);

  if (ownerUserId) {
    const userTemplateId = await redis.get<string>(
      userTemplateSlugKey(ownerUserId, normalizedSlug)
    );
    if (userTemplateId) {
      const detail = await getTemplateDetailInRedis(redis, userTemplateId);
      if (detail?.template.latestPublishedVersionId) {
        const version =
          detail.versions.find(
            (candidate) =>
              candidate.id === detail.template.latestPublishedVersionId
          ) ?? null;
        if (version) {
          return {
            template: detail.template,
            version,
          };
        }
      }
    }
  }

  if (!isSystemTemplateSlug(normalizedSlug)) {
    return null;
  }

  const system = buildSystemTemplateRecord(normalizedSlug);
  return {
    template: system.template,
    version: system.version,
  };
}

export async function resolveTemplateById(
  templateId: string
): Promise<TemplateServiceResolveResponse | null> {
  return resolveTemplateByIdInRedis(getRedis(), templateId);
}

export async function resolveTemplateByIdInRedis(
  redis: TemplateServiceRedis,
  templateId: string
): Promise<TemplateServiceResolveResponse | null> {
  const detail = await getTemplateDetailInRedis(redis, templateId);
  if (!detail) {
    return null;
  }

  const preferredVersionId =
    detail.template.latestPublishedVersionId ?? detail.template.latestVersionId;
  const version =
    detail.versions.find((candidate) => candidate.id === preferredVersionId) ??
    null;
  if (!version) {
    return null;
  }

  return {
    template: detail.template,
    version,
  };
}

export async function resolveLaunchableTemplateBySlug(
  slug: string,
  ownerUserId: string | null
): Promise<SandcastleTemplateDefinition | null> {
  return resolveLaunchableTemplateBySlugInRedis(getRedis(), slug, ownerUserId);
}

export async function resolveLaunchableTemplateBySlugInRedis(
  redis: TemplateServiceRedis,
  slug: string,
  ownerUserId: string | null
): Promise<SandcastleTemplateDefinition | null> {
  const resolved = await resolveTemplateBySlugInRedis(redis, slug, ownerUserId);
  if (!resolved) {
    return null;
  }

  if (
    resolved.template.status !== "active" ||
    resolved.version.state !== "published"
  ) {
    return null;
  }

  return materializeLaunchTemplate(resolved);
}
