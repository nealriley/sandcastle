import assert from "node:assert/strict";
import test from "node:test";
import {
  createUserTemplateInRedis,
  createUserTemplateVersionInRedis,
  listSystemTemplateCatalogEntries,
  listTemplateCatalogInRedis,
  normalizeDeclarativeTemplateSpec,
  publishUserTemplateVersionInRedis,
  resolveLaunchableTemplateBySlugInRedis,
  resolveTemplateBySlugInRedis,
  TemplateServiceError,
  updateUserTemplateInRedis,
  updateUserTemplateVersionInRedis,
} from "../lib/template-service.js";
import { FakeRedis } from "./helpers/fake-redis.js";

const fakeRedis = new FakeRedis();
const ORIGINAL_DATE_NOW = Date.now;

test.afterEach(() => {
  fakeRedis.reset();
  Date.now = ORIGINAL_DATE_NOW;
});

test("system template catalog exposes the current built-ins through the service layer", () => {
  const entries = listSystemTemplateCatalogEntries();

  assert.ok(entries.some((entry) => entry.slug === "claude-code"));
  assert.ok(entries.some((entry) => entry.slug === "codex"));
  assert.ok(entries.some((entry) => entry.slug === "website-deep-dive"));
  assert.ok(entries.some((entry) => entry.slug === "wordcount"));
  assert.ok(entries.every((entry) => entry.ownerType === "system"));
  assert.ok(entries.every((entry) => entry.latestVersionState === "published"));
  assert.equal(
    entries.find((entry) => entry.slug === "claude-code")?.executionStrategyKind,
    "claude-agent"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "codex")?.executionStrategyKind,
    "codex-agent"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "wordcount")?.executionStrategyKind,
    "shell-command"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "wordcount")?.acceptsPrompts,
    true
  );
  assert.equal(
    entries.find((entry) => entry.slug === "codex")?.environmentSchema[0]?.inputType,
    "select"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "website-deep-dive")?.environmentSchema[0]
      ?.inputType,
    "select"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "wordcount")?.environmentSchema[0]?.key,
    "WORDCOUNT_METHOD"
  );
  assert.equal(
    entries.find((entry) => entry.slug === "wordcount")?.environmentSchema[0]
      ?.inputType,
    "select"
  );
});

test("normalizeDeclarativeTemplateSpec defaults executionStrategy to claude-agent", () => {
  const spec = normalizeDeclarativeTemplateSpec({});

  assert.deepEqual(spec.executionStrategy, { kind: "claude-agent" });
});

test("normalizeDeclarativeTemplateSpec validates shell-command execution strategies", () => {
  const spec = normalizeDeclarativeTemplateSpec({
    executionStrategy: {
      kind: "shell-command",
      cmd: "bash",
      args: ["-lc", "echo hello"],
      cwd: "/vercel/sandbox",
    },
  });

  assert.deepEqual(spec.executionStrategy, {
    kind: "shell-command",
    cmd: "bash",
    args: ["-lc", "echo hello"],
    cwd: "/vercel/sandbox",
    promptMode: "none",
    promptEnvKey: null,
  });

  assert.throws(
    () =>
      normalizeDeclarativeTemplateSpec({
        executionStrategy: {
          kind: "shell-command",
          cmd: "bash",
          args: ["-lc", 42],
        },
      }),
    (error: unknown) =>
      error instanceof TemplateServiceError &&
      error.message.includes("executionStrategy.args[1]")
  );
});

test("normalizeDeclarativeTemplateSpec validates select-based environment fields", () => {
  const spec = normalizeDeclarativeTemplateSpec({
    environmentSchema: [
      {
        key: "OPENAI_MODEL",
        label: "OpenAI model",
        description: "Pick the model.",
        inputType: "select",
        defaultValue: "gpt-5.2-codex",
        options: [
          {
            value: "gpt-5.2-codex",
            label: "GPT-5.2 Codex",
          },
          {
            value: "gpt-5-codex",
            label: "GPT-5 Codex",
          },
        ],
      },
    ],
  });

  assert.equal(spec.environmentSchema[0]?.inputType, "select");
  assert.equal(spec.environmentSchema[0]?.options[0]?.value, "gpt-5.2-codex");

  assert.throws(
    () =>
      normalizeDeclarativeTemplateSpec({
        environmentSchema: [
          {
            key: "OPENAI_MODEL",
            label: "OpenAI model",
            description: "Pick the model.",
            inputType: "select",
            options: [],
          },
        ],
      }),
    (error: unknown) =>
      error instanceof TemplateServiceError &&
      error.message.includes("options must contain at least one option")
  );
});

test("user templates can be created, updated, versioned, published, and resolved from Redis storage", async () => {
  Date.now = () => 10_000;

  const created = await createUserTemplateInRedis(fakeRedis, {
    ownerUserId: "user_123",
    slug: "custom-audit",
    name: "Custom Audit",
    summary: "A user-owned audit template.",
    purpose: "Tests Redis-backed template CRUD.",
  });

  assert.equal(created.template.ownerType, "user");
  assert.equal(created.template.slug, "custom-audit");
  assert.equal(created.versions.length, 1);
  assert.equal(created.versions[0]?.state, "draft");
  assert.deepEqual(created.versions[0]?.spec.executionStrategy, {
    kind: "claude-agent",
  });

  const updated = await updateUserTemplateInRedis(
    fakeRedis,
    "user_123",
    created.template.id,
    {
      name: "Custom Audit v2",
      launchLabel: "Launch custom audit",
    }
  );

  assert.equal(updated.template.name, "Custom Audit v2");
  assert.equal(updated.template.launchLabel, "Launch custom audit");

  const versionId = created.versions[0]!.id;
  const updatedVersion = await updateUserTemplateVersionInRedis(
    fakeRedis,
    "user_123",
    versionId,
    {
      changelog: "Add a hello.txt bootstrap step.",
      spec: {
        runtimeConstraints: {
          defaultRuntime: "node24",
          supportedRuntimes: ["node24"],
        },
        launchConfig: {
          ports: [3000],
          timeoutMs: 120000,
          vcpus: 2,
        },
        environmentSchema: [
          {
            key: "CUSTOM_API_KEY",
            label: "Custom API key",
            description: "Used by the template.",
            required: false,
            secret: true,
            inputType: "text",
            options: [],
          },
        ],
        promptConfig: {
          promptPlaceholder: "Describe what the sandbox should set up.",
          defaultPrompt: "Create the workspace.",
          initialPromptTemplate: "{{prompt}}",
          followUpHint: "Keep outputs small.",
        },
        bootstrapManifest: {
          operations: [
            {
              kind: "write_file",
              path: "/vercel/sandbox/hello.txt",
              content: "hello world",
              executable: false,
            },
            {
              kind: "run_command",
              cmd: "bash",
              args: ["-lc", "echo template"],
              cwd: "/vercel/sandbox",
              detached: false,
              description: "Emit a setup marker",
            },
          ],
          previewPorts: [3000],
        },
      },
    }
  );

  const draftVersion = updatedVersion.versions.find(
    (version) => version.id === versionId
  );
  assert.equal(draftVersion?.state, "draft");
  assert.equal(draftVersion?.spec.kind, "declarative");
  assert.deepEqual(draftVersion?.spec.executionStrategy, {
    kind: "claude-agent",
  });

  const published = await publishUserTemplateVersionInRedis(
    fakeRedis,
    "user_123",
    versionId
  );
  assert.equal(published.template.latestPublishedVersionId, versionId);
  assert.equal(
    published.versions.find((version) => version.id === versionId)?.state,
    "published"
  );

  Date.now = () => 20_000;
  const nextDraft = await createUserTemplateVersionInRedis(
    fakeRedis,
    "user_123",
    created.template.id
  );
  const draftCount = nextDraft.versions.filter(
    (version) => version.state === "draft"
  ).length;
  assert.equal(draftCount, 1);
  assert.equal(nextDraft.template.latestVersionId, nextDraft.versions[0]?.id);

  const catalog = await listTemplateCatalogInRedis(fakeRedis, "user_123");
  assert.ok(catalog.templates.some((entry) => entry.slug === "custom-audit"));
  assert.equal(
    catalog.templates.find((entry) => entry.slug === "custom-audit")
      ?.executionStrategyKind,
    "claude-agent"
  );

  const resolved = await resolveTemplateBySlugInRedis(
    fakeRedis,
    "custom-audit",
    "user_123"
  );
  assert.ok(resolved);
  assert.equal(resolved?.template.id, created.template.id);
  assert.equal(resolved?.version.id, versionId);
  assert.equal(resolved?.version.state, "published");
});

test("user template slugs may not collide with system templates", async () => {
  await assert.rejects(
    () =>
      createUserTemplateInRedis(fakeRedis, {
        ownerUserId: "user_123",
        slug: "claude-code",
        name: "Bad collision",
        summary: "Should fail",
        purpose: "Should fail",
      }),
    (error: unknown) =>
      error instanceof TemplateServiceError && error.status === 409
  );
});

test("launchable template resolution preserves built-ins and published user templates", async () => {
  const systemTemplate = await resolveLaunchableTemplateBySlugInRedis(
    fakeRedis,
    "claude-code",
    null
  );
  assert.ok(systemTemplate);
  assert.equal(systemTemplate?.slug, "claude-code");

  const created = await createUserTemplateInRedis(fakeRedis, {
    ownerUserId: "user_123",
    slug: "custom-launch",
    name: "Custom Launch",
    summary: "A launchable user template.",
    purpose: "Verifies launchable template adaptation.",
  });

  const versionId = created.versions[0]!.id;
  await updateUserTemplateVersionInRedis(fakeRedis, "user_123", versionId, {
    spec: {
      runtimeConstraints: {
        defaultRuntime: "node24",
        supportedRuntimes: ["node24", "node22"],
      },
      executionStrategy: {
        kind: "shell-command",
        cmd: "bash",
        args: ["-lc", "echo bootstrap ready"],
        cwd: "/vercel/sandbox",
        promptMode: "none",
        promptEnvKey: null,
      },
      launchConfig: {
        ports: [3000, 4173],
        timeoutMs: 180000,
        vcpus: 2,
      },
      environmentSchema: [
        {
          key: "CUSTOM_ENDPOINT",
          label: "Custom endpoint",
          description: "API endpoint for the template.",
          required: true,
          secret: false,
          inputType: "text",
          options: [],
        },
      ],
      promptConfig: {
        promptPlaceholder: "Describe the sandbox bootstrap work.",
        defaultPrompt: "Inspect the provided endpoint.",
        initialPromptTemplate:
          "Template bootstrap request:\n{{prompt}}\n\nEnvironment keys: {{environment_keys}}",
        followUpHint: "Keep logs concise.",
      },
      bootstrapManifest: {
        operations: [
          {
            kind: "write_file",
            path: "/vercel/sandbox/bootstrap.txt",
            content: "bootstrap ready",
            executable: false,
          },
        ],
        previewPorts: [4173],
      },
    },
  });
  await publishUserTemplateVersionInRedis(fakeRedis, "user_123", versionId);

  const launchable = await resolveLaunchableTemplateBySlugInRedis(
    fakeRedis,
    "custom-launch",
    "user_123"
  );
  assert.ok(launchable);
  assert.equal(launchable?.slug, "custom-launch");
  assert.deepEqual(launchable?.supportedRuntimes, ["node24", "node22"]);
  assert.deepEqual(launchable?.executionStrategy, {
    kind: "shell-command",
    cmd: "bash",
    args: ["-lc", "echo bootstrap ready"],
    cwd: "/vercel/sandbox",
    promptMode: "none",
    promptEnvKey: null,
  });
  assert.equal(launchable?.ports[1], 4173);
  assert.equal(launchable?.envHints[0]?.key, "CUSTOM_ENDPOINT");
  assert.match(
    launchable?.buildInitialPrompt({
      prompt: "Run the diagnostics.",
      environment: { CUSTOM_ENDPOINT: "https://example.com" },
    }) ?? "",
    /Environment keys: CUSTOM_ENDPOINT/
  );
});
