import type { RuntimeName, TemplateSourceKind } from "./types.js";

export type TemplateOwnerType = "system" | "user";
export type TemplateVisibility = "system" | "private";
export type TemplateRecordStatus = "active" | "archived";
export type TemplateVersionState = "draft" | "published" | "deprecated";
export type TemplateSpecKind = "legacy_builtin" | "declarative";
export type ShellCommandPromptMode = "none" | "env";

export type ExecutionStrategy =
  | { kind: "claude-agent" }
  | { kind: "codex-agent" }
  | {
      kind: "shell-command";
      cmd: string;
      args: string[];
      cwd: string | null;
      promptMode: ShellCommandPromptMode;
      promptEnvKey: string | null;
    };

export interface TemplateSourceRuntime {
  kind: "runtime";
}

export interface TemplateSourceSnapshot {
  kind: "snapshot";
  snapshotEnvVar: string;
  snapshotRuntime: RuntimeName;
}

export type TemplateSourceConfig =
  | TemplateSourceRuntime
  | TemplateSourceSnapshot;

export interface TemplateRuntimeConstraints {
  defaultRuntime: RuntimeName;
  supportedRuntimes: RuntimeName[];
}

export interface TemplateLaunchConfig {
  ports: number[];
  timeoutMs: number;
  vcpus: number;
}

export type TemplateEnvironmentFieldInputType = "text" | "select";

export interface TemplateEnvironmentFieldOption {
  value: string;
  label: string;
  description: string | null;
}

export interface TemplateEnvironmentField {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  defaultValue: string | null;
  inputType: TemplateEnvironmentFieldInputType;
  options: TemplateEnvironmentFieldOption[];
}

export interface TemplatePromptConfig {
  promptPlaceholder: string;
  defaultPrompt: string | null;
  initialPromptTemplate: string | null;
  followUpHint: string | null;
}

export interface TemplateWriteFileOperation {
  kind: "write_file";
  path: string;
  content: string;
  executable: boolean;
}

export interface TemplateRunCommandOperation {
  kind: "run_command";
  cmd: string;
  args: string[];
  cwd: string | null;
  detached: boolean;
  description: string | null;
}

export type TemplateBootstrapOperation =
  | TemplateWriteFileOperation
  | TemplateRunCommandOperation;

export interface TemplateBootstrapManifest {
  operations: TemplateBootstrapOperation[];
  previewPorts: number[];
}

interface BaseTemplateSpec {
  kind: TemplateSpecKind;
  source: TemplateSourceConfig;
  runtimeConstraints: TemplateRuntimeConstraints;
  launchConfig: TemplateLaunchConfig;
  environmentSchema: TemplateEnvironmentField[];
  promptConfig: TemplatePromptConfig;
  executionStrategy: ExecutionStrategy;
}

export interface LegacyBuiltinTemplateSpec extends BaseTemplateSpec {
  kind: "legacy_builtin";
  legacyBuiltinSlug: string;
  assetBundleRef: string | null;
}

export interface DeclarativeTemplateSpec extends BaseTemplateSpec {
  kind: "declarative";
  bootstrapManifest: TemplateBootstrapManifest;
  assetBundleRef: string | null;
}

export type TemplateSpec = LegacyBuiltinTemplateSpec | DeclarativeTemplateSpec;

export interface TemplateRecord {
  id: string;
  slug: string;
  ownerType: TemplateOwnerType;
  ownerUserId: string | null;
  name: string;
  summary: string;
  purpose: string;
  launchLabel: string;
  visibility: TemplateVisibility;
  status: TemplateRecordStatus;
  createdAt: number;
  updatedAt: number;
  latestVersionId: string;
  latestPublishedVersionId: string | null;
}

export interface TemplateVersionRecord {
  id: string;
  templateId: string;
  versionNumber: number;
  state: TemplateVersionState;
  createdBy: string | null;
  changelog: string | null;
  createdAt: number;
  spec: TemplateSpec;
}

export interface TemplateCatalogEntry {
  templateId: string;
  slug: string;
  ownerType: TemplateOwnerType;
  ownerUserId: string | null;
  name: string;
  summary: string;
  purpose: string;
  launchLabel: string;
  visibility: TemplateVisibility;
  templateStatus: TemplateRecordStatus;
  latestVersionId: string;
  latestVersionState: TemplateVersionState;
  sourceKind: TemplateSourceKind;
  defaultRuntime: RuntimeName;
  supportedRuntimes: RuntimeName[];
  executionStrategyKind: ExecutionStrategy["kind"];
  acceptsPrompts: boolean;
  promptPlaceholder: string;
  defaultPrompt: string | null;
  environmentSchema: TemplateEnvironmentField[];
}

export interface TemplateServiceListResponse {
  templates: TemplateCatalogEntry[];
  defaultTemplateSlug: string;
}

export interface TemplateServiceTemplateResponse {
  template: TemplateRecord;
  versions: TemplateVersionRecord[];
}

export interface TemplateServiceResolveResponse {
  template: TemplateRecord;
  version: TemplateVersionRecord;
}
