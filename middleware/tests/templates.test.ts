import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertTemplateConfiguration,
  getCreatableSandcastleTemplate,
  getSandcastleTemplate,
  resolveTemplateEnvironment,
  resolveTemplatePrompt,
  summarizeTemplateRuntimes,
} from "../lib/templates.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

test("getSandcastleTemplate returns known templates by slug", () => {
  const standard = getSandcastleTemplate("standard");
  const validation = getSandcastleTemplate("shell-scripts-validation");

  assert.equal(standard?.name, "Standard");
  assert.equal(validation?.status, "live");
  assert.equal(getSandcastleTemplate("missing"), null);
});

test("getCreatableSandcastleTemplate only returns live templates", () => {
  assert.equal(getCreatableSandcastleTemplate("standard")?.slug, "standard");
  assert.equal(
    getCreatableSandcastleTemplate("shell-scripts-validation")?.slug,
    "shell-scripts-validation"
  );
});

test("assertTemplateConfiguration accepts the current built-in registry", () => {
  assert.doesNotThrow(() => assertTemplateConfiguration());
});

test("summarizeTemplateRuntimes renders user-facing runtime labels", () => {
  const standard = getSandcastleTemplate("standard");
  assert.ok(standard);
  assert.equal(
    summarizeTemplateRuntimes(standard),
    "Node 24, Node 22, Python 3.13"
  );
});

test("resolveTemplatePrompt uses the validation default flow and only mentions env keys", () => {
  const template = getSandcastleTemplate("shell-scripts-validation");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(template, "", {
    VALIDATION_API_KEY: "super-secret-token",
    VALIDATION_REQUEST_URL: "https://example.test/health",
  });

  assert.match(prompt, /verify-all\.sh/);
  assert.match(prompt, /VALIDATION_API_KEY/);
  assert.doesNotMatch(prompt, /super-secret-token/);
});

test("resolveTemplateEnvironment injects the default validation URL for the shell template", () => {
  const template = getSandcastleTemplate("shell-scripts-validation");
  assert.ok(template);

  const resolved = resolveTemplateEnvironment(
    template,
    { VALIDATION_API_KEY: "secret" },
    { templateValidationUrl: "https://sandcastle.test/api/template-validation" }
  );

  assert.deepEqual(resolved, {
    VALIDATION_API_KEY: "secret",
    VALIDATION_REQUEST_URL: "https://sandcastle.test/api/template-validation",
  });
});

test("resolveTemplatePrompt gives webpage inspector concrete workflow instructions", () => {
  const template = getSandcastleTemplate("webpage-inspector");
  assert.ok(template);

  const prompt = resolveTemplatePrompt(
    template,
    "Inspect https://example.com and focus on headings and metadata.",
    {
      PAGE_AUDIT_AUTH_TOKEN: "secret-token",
    }
  );

  assert.match(prompt, /inspect-page\.sh/);
  assert.match(prompt, /report-site\/index\.html/);
  assert.match(prompt, /https:\/\/example\.com/);
  assert.doesNotMatch(prompt, /secret-token/);
});

test("validation template bootstrap writes the verification files", async () => {
  const template = getSandcastleTemplate("shell-scripts-validation");
  assert.ok(template);

  const sandbox = new FakeSandbox();
  await template.bootstrap(sandbox as never, {
    runtime: "node24",
    environment: {
      VALIDATION_API_KEY: "secret",
      VALIDATION_REQUEST_URL: "https://example.test/health",
    },
  });

  const readme = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/README.md",
  });
  const manifest = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/env-keys.txt",
  });
  const requestScript = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/verify-request.sh",
  });
  assert.ok(readme);
  assert.ok(manifest);
  assert.ok(requestScript);

  assert.match(readme.toString("utf-8"), /Shell Scripts Validation Template/);
  assert.equal(
    manifest.toString("utf-8"),
    "VALIDATION_API_KEY\nVALIDATION_REQUEST_URL\n"
  );
  assert.match(requestScript.toString("utf-8"), /Header name: none/);
  assert.doesNotMatch(
    requestScript.toString("utf-8"),
    /VALIDATION_API_KEY is not set/
  );
  assert.deepEqual(sandbox.commandLog, [
    {
      cmd: "bash",
      args: [
        "-lc",
        "chmod +x /vercel/sandbox/sandcastle-template/verify-runtime.sh /vercel/sandbox/sandcastle-template/verify-env.sh /vercel/sandbox/sandcastle-template/verify-request.sh /vercel/sandbox/sandcastle-template/verify-all.sh",
      ],
    },
  ]);
});

test("webpage inspector template bootstrap writes scripts and starts the report server", async () => {
  const template = getSandcastleTemplate("webpage-inspector");
  assert.ok(template);

  const sandbox = new FakeSandbox();
  await template.bootstrap(sandbox as never, {
    runtime: "node24",
    environment: {
      PAGE_AUDIT_AUTH_HEADER_NAME: "Authorization",
      PAGE_AUDIT_AUTH_SCHEME: "Bearer",
      PAGE_AUDIT_AUTH_TOKEN: "secret-token",
    },
  });

  const readme = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/README.md",
  });
  const inspectScript = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/inspect-page.sh",
  });
  const library = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/page-audit-lib.mjs",
  });
  const placeholder = await sandbox.readFileToBuffer({
    path: "/vercel/sandbox/sandcastle-template/report-site/index.html",
  });

  assert.ok(readme);
  assert.ok(inspectScript);
  assert.ok(library);
  assert.ok(placeholder);
  assert.match(readme.toString("utf-8"), /Webpage Inspector Template/);
  assert.match(inspectScript.toString("utf-8"), /page-inspector\.mjs/);
  assert.match(library.toString("utf-8"), /inspectWebpage/);
  assert.match(placeholder.toString("utf-8"), /preview is ready/i);

  assert.deepEqual(sandbox.commandLog, [
    {
      cmd: "bash",
      args: [
        "-lc",
        "chmod +x /vercel/sandbox/sandcastle-template/inspect-page.sh /vercel/sandbox/sandcastle-template/serve-report.sh /vercel/sandbox/sandcastle-template/show-summary.sh",
      ],
    },
    {
      cmd: "python3",
      args: [
        "-m",
        "http.server",
        "4173",
        "--directory",
        "/vercel/sandbox/sandcastle-template/report-site",
        "--bind",
        "0.0.0.0",
      ],
    },
  ]);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "webpage-inspector-"));
  const modulePath = path.join(tempDir, "page-audit-lib.mjs");
  const renderedPath = path.join(tempDir, "rendered.html");
  await fs.writeFile(modulePath, library);
  const check = spawnSync(process.execPath, ["--check", modulePath], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const sampleReport = {
    targetUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    durationMs: 120,
    generatedAt: "2026-03-07T00:00:00.000Z",
    contentType: "text/html; charset=utf-8",
    focusNotes: "Check metadata",
    auth: {
      configured: false,
      headerName: null,
      scheme: null,
      tokenLength: null,
    },
    robots: {
      ok: true,
      status: 200,
      preview: "User-agent: *",
    },
    sitemap: {
      ok: false,
      status: 404,
      preview: null,
    },
    diagnostics: {
      title: "Example",
      metaDescription: "Example description",
      metaRobots: null,
      ogTitle: null,
      ogDescription: null,
      canonical: "https://example.com/",
      htmlLang: "en",
      viewport: "width=device-width, initial-scale=1",
      headings: {
        h1: ["Example heading"],
        h2: ["Section heading"],
      },
      counts: {
        htmlBytes: 1024,
        words: 240,
        internalLinks: 4,
        externalLinks: 2,
        images: 1,
        scripts: 3,
        stylesheets: 1,
        forms: 0,
      },
      snippet: "Example snippet",
      securityHeaders: {
        contentSecurityPolicy: false,
        strictTransportSecurity: true,
        frameOptions: false,
        referrerPolicy: true,
        contentTypeOptions: true,
        permissionsPolicy: false,
      },
      technologyHints: ["next.js assets detected"],
      recommendations: ["Add a Content-Security-Policy header."],
    },
  };
  const render = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import fs from "node:fs/promises"; const mod = await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const report = ${JSON.stringify(sampleReport)}; const html = mod.renderHtmlReport(report); await fs.writeFile(${JSON.stringify(renderedPath)}, html, "utf8");`,
    ],
    { encoding: "utf8" }
  );
  assert.equal(render.status, 0, render.stderr || render.stdout);
  const renderedHtml = await fs.readFile(renderedPath, "utf8");
  assert.match(renderedHtml, /<!doctype html>/i);
  assert.doesNotMatch(renderedHtml, /\\n/);
  await fs.rm(tempDir, { recursive: true, force: true });
});
