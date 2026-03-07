export const WEBPAGE_INSPECTOR_TEMPLATE_DIR =
  "/vercel/sandbox/sandcastle-template";
export const WEBPAGE_INSPECTOR_REPORT_DIR =
  `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/report-site`;
export const WEBPAGE_INSPECTOR_OUTPUT_DIR =
  `${WEBPAGE_INSPECTOR_TEMPLATE_DIR}/output`;
export const WEBPAGE_INSPECTOR_PORT = 4173;

export function buildWebpageInspectorReadme(): string {
  return [
    "# Sandcastle Webpage Inspector Template",
    "",
    "This template is designed for SHGO and Sandcastle tasks where the user",
    "provides an HTTP or HTTPS URL and wants a structured audit plus a browser",
    "report they can open live.",
    "",
    "Workflow:",
    "1. Run ./sandcastle-template/inspect-page.sh \"https://target.example\"",
    "2. Review /vercel/sandbox/sandcastle-template/output/latest-summary.txt",
    "3. Open the live report preview served from port 4173",
    "",
    "Files written by the audit flow:",
    "- output/latest-report.json",
    "- output/latest-summary.txt",
    "- report-site/index.html",
    "- report-site/latest.json",
    "",
    "Helper scripts:",
    "- ./sandcastle-template/inspect-page.sh",
    "- ./sandcastle-template/show-summary.sh",
    "- ./sandcastle-template/serve-report.sh",
    "",
    "Optional launch environment variables:",
    "- PAGE_AUDIT_AUTH_TOKEN",
    "- PAGE_AUDIT_AUTH_HEADER_NAME (defaults to Authorization)",
    "- PAGE_AUDIT_AUTH_SCHEME (defaults to Bearer when using Authorization)",
    "",
    "The template never writes the raw auth token into the generated JSON,",
    "HTML report, or plain-text summary.",
    "",
  ].join("\n");
}

export function buildWebpageInspectorPlaceholderReport(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sandcastle Webpage Inspector</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f7f5;
        --panel: #ffffff;
        --text: #171717;
        --muted: #6b7280;
        --border: #e5e7eb;
        --accent: #111827;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Geist Sans", "Helvetica Neue", sans-serif;
        color: var(--text);
        background: linear-gradient(180deg, #fafaf9 0%, #f3f4f6 100%);
        padding: 48px 24px;
      }
      .shell {
        max-width: 880px;
        margin: 0 auto;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 16px 50px rgba(15, 23, 42, 0.08);
      }
      h1 { margin: 0 0 12px; font-size: 2rem; }
      p { margin: 0 0 16px; line-height: 1.6; color: var(--muted); }
      code {
        background: #f3f4f6;
        border-radius: 6px;
        padding: 2px 6px;
        color: var(--accent);
      }
      ol { padding-left: 20px; color: var(--text); line-height: 1.7; }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1>Webpage inspector preview is ready</h1>
      <p>
        This sandbox already has a live report server running. Generate a report
        by running <code>./sandcastle-template/inspect-page.sh "https://example.com"</code>.
      </p>
      <ol>
        <li>Run the inspect script against the page you want to analyze.</li>
        <li>Open this preview again to see the rendered HTML report.</li>
        <li>Check <code>output/latest-summary.txt</code> for the plain-text summary.</li>
      </ol>
    </main>
  </body>
</html>
`;
}

export function buildWebpageInspectorLibrary(): string {
  return String.raw`import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TEMPLATE_DIR = ${JSON.stringify(WEBPAGE_INSPECTOR_TEMPLATE_DIR)};
const OUTPUT_DIR = ${JSON.stringify(WEBPAGE_INSPECTOR_OUTPUT_DIR)};
const REPORT_DIR = ${JSON.stringify(WEBPAGE_INSPECTOR_REPORT_DIR)};
const REPORT_JSON_PATH = path.join(OUTPUT_DIR, "latest-report.json");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "latest-summary.txt");
const TARGET_PATH = path.join(OUTPUT_DIR, "latest-target.txt");
const REPORT_HTML_PATH = path.join(REPORT_DIR, "index.html");
const REPORT_JSON_PUBLIC_PATH = path.join(REPORT_DIR, "latest.json");

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function extractTagText(html, tagName) {
  const pattern = new RegExp("<" + tagName + "[^>]*>([\\s\\S]*?)<\\/" + tagName + ">", "gi");
  const matches = [];
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[1]).trim();
    if (text) {
      matches.push(text);
    }
  }
  return unique(matches);
}

function extractAttributeValues(html, tagName, attributeName) {
  const pattern = new RegExp(
    "<" +
      tagName +
      "\\b[^>]*" +
      attributeName +
      "=[\"']([^\"']+)[\"'][^>]*>",
    "gi"
  );
  const matches = [];
  for (const match of html.matchAll(pattern)) {
    if (match[1]) {
      matches.push(match[1].trim());
    }
  }
  return matches;
}

function extractMetaContent(html, key, attribute) {
  const patterns = [
    new RegExp(
      "<meta[^>]*" +
        attribute +
        "=[\"']" +
        key.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&") +
        "[\"'][^>]*content=[\"']([^\"']*)[\"'][^>]*>",
      "i"
    ),
    new RegExp(
      "<meta[^>]*content=[\"']([^\"']*)[\"'][^>]*" +
        attribute +
        "=[\"']" +
        key.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&") +
        "[\"'][^>]*>",
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return decodeEntities(match[1].trim());
    }
  }

  return null;
}

function extractFirstAttribute(html, tagName, attributeName) {
  const values = extractAttributeValues(html, tagName, attributeName);
  return values[0] || null;
}

function classifyLinks(linkHrefs, baseUrl) {
  let internal = 0;
  let external = 0;
  let invalid = 0;

  for (const href of linkHrefs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin === baseUrl.origin) {
        internal += 1;
      } else {
        external += 1;
      }
    } catch {
      invalid += 1;
    }
  }

  return { internal, external, invalid };
}

function collectTechnologyHints(html, headers) {
  const hints = [];
  const lowerHtml = html.toLowerCase();

  if (headers["x-powered-by"]) {
    hints.push("x-powered-by: " + headers["x-powered-by"]);
  }
  if (headers.server) {
    hints.push("server: " + headers.server);
  }

  const generator = extractMetaContent(html, "generator", "name");
  if (generator) {
    hints.push("generator: " + generator);
  }

  if (lowerHtml.includes("/_next/")) hints.push("next.js assets detected");
  if (lowerHtml.includes("/wp-content/")) hints.push("wordpress assets detected");
  if (lowerHtml.includes("data-reactroot") || lowerHtml.includes("__next")) {
    hints.push("react app markers detected");
  }
  if (lowerHtml.includes("gtag(") || lowerHtml.includes("googletagmanager")) {
    hints.push("google analytics or tag manager detected");
  }
  if (lowerHtml.includes("segment.com/analytics")) {
    hints.push("segment analytics detected");
  }

  return unique(hints);
}

function buildRequestHeaders(env) {
  const authToken = String(env.PAGE_AUDIT_AUTH_TOKEN || "").trim();
  if (!authToken) {
    return {};
  }

  const headerName = String(env.PAGE_AUDIT_AUTH_HEADER_NAME || "Authorization").trim() || "Authorization";
  const scheme = String(env.PAGE_AUDIT_AUTH_SCHEME || "Bearer").trim() || "Bearer";
  const value =
    headerName.toLowerCase() === "authorization" && scheme
      ? scheme + " " + authToken
      : authToken;

  return {
    [headerName]: value,
  };
}

function summarizeAuthConfig(env) {
  const authToken = String(env.PAGE_AUDIT_AUTH_TOKEN || "").trim();
  const headerName = String(env.PAGE_AUDIT_AUTH_HEADER_NAME || "Authorization").trim() || "Authorization";
  const scheme = String(env.PAGE_AUDIT_AUTH_SCHEME || "Bearer").trim() || "Bearer";

  return {
    configured: Boolean(authToken),
    headerName: authToken ? headerName : null,
    scheme:
      authToken && headerName.toLowerCase() === "authorization" ? scheme || null : null,
    tokenLength: authToken ? authToken.length : null,
  };
}

function normalizeTargetUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("A target URL is required.");
  }

  const candidate = /^https?:\/\//i.test(value) ? value : "https://" + value;
  const url = new URL(candidate);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return url.toString();
}

async function fetchText(url, init) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
  });
  const text = await response.text();
  return {
    response,
    text,
    durationMs: Date.now() - startedAt,
  };
}

async function probeCompanionResource(baseUrl, pathname, headers) {
  try {
    const target = new URL(pathname, baseUrl).toString();
    const result = await fetchText(target, { headers });
    return {
      url: result.response.url,
      status: result.response.status,
      ok: result.response.ok,
      preview: stripTags(result.text).slice(0, 240) || null,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      url: new URL(pathname, baseUrl).toString(),
      status: null,
      ok: false,
      preview: null,
      durationMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchPageArtifacts(targetUrl, env = process.env) {
  const headers = buildRequestHeaders(env);
  const result = await fetchText(normalizeTargetUrl(targetUrl), { headers });

  const responseHeaders = {};
  result.response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  return {
    targetUrl: normalizeTargetUrl(targetUrl),
    finalUrl: result.response.url,
    status: result.response.status,
    ok: result.response.ok,
    durationMs: result.durationMs,
    html: result.text,
    responseHeaders,
    contentType: result.response.headers.get("content-type"),
  };
}

export function extractPageDiagnostics(artifacts) {
  const html = artifacts.html;
  const baseUrl = new URL(artifacts.finalUrl || artifacts.targetUrl);
  const pageText = stripTags(html);
  const words = pageText ? pageText.split(/\s+/).filter(Boolean) : [];
  const title = extractTagText(html, "title")[0] || null;
  const metaDescription = extractMetaContent(html, "description", "name");
  const metaRobots = extractMetaContent(html, "robots", "name");
  const ogTitle = extractMetaContent(html, "og:title", "property");
  const ogDescription = extractMetaContent(html, "og:description", "property");
  const canonical = extractFirstAttribute(html, "link", "href");
  const htmlLang = extractFirstAttribute(html, "html", "lang");
  const viewport = extractMetaContent(html, "viewport", "name");
  const headings = {
    h1: extractTagText(html, "h1").slice(0, 8),
    h2: extractTagText(html, "h2").slice(0, 12),
  };
  const links = extractAttributeValues(html, "a", "href");
  const images = extractAttributeValues(html, "img", "src");
  const scripts = extractAttributeValues(html, "script", "src");
  const stylesheets = extractAttributeValues(html, "link", "href").filter((href) =>
    /\.css(\?|$)/i.test(href)
  );
  const forms = (html.match(/<form\b/gi) || []).length;
  const linkBreakdown = classifyLinks(links, baseUrl);
  const securityHeaders = {
    contentSecurityPolicy: Boolean(artifacts.responseHeaders["content-security-policy"]),
    strictTransportSecurity: Boolean(artifacts.responseHeaders["strict-transport-security"]),
    frameOptions: Boolean(artifacts.responseHeaders["x-frame-options"]),
    referrerPolicy: Boolean(artifacts.responseHeaders["referrer-policy"]),
    contentTypeOptions: Boolean(artifacts.responseHeaders["x-content-type-options"]),
    permissionsPolicy: Boolean(artifacts.responseHeaders["permissions-policy"]),
  };

  const recommendations = [];
  if (!title) recommendations.push("Add a <title> tag.");
  if (!metaDescription) recommendations.push("Add a meta description.");
  if (!htmlLang) recommendations.push("Set the html lang attribute.");
  if (!viewport) recommendations.push("Add a responsive viewport meta tag.");
  if (headings.h1.length === 0) recommendations.push("Add a clear H1 heading.");
  if (!canonical) recommendations.push("Add a canonical link tag.");
  if (!securityHeaders.contentSecurityPolicy) recommendations.push("Consider adding a Content-Security-Policy header.");
  if (!securityHeaders.strictTransportSecurity) recommendations.push("Consider enabling Strict-Transport-Security.");
  if (scripts.length > 20) recommendations.push("Reduce the number of script assets loaded on first paint.");
  if (artifacts.html.length > 350000) recommendations.push("The raw HTML payload is large; consider reducing server-rendered markup.");

  return {
    title,
    metaDescription,
    metaRobots,
    ogTitle,
    ogDescription,
    canonical,
    htmlLang,
    viewport,
    headings,
    counts: {
      internalLinks: linkBreakdown.internal,
      externalLinks: linkBreakdown.external,
      invalidLinks: linkBreakdown.invalid,
      images: images.length,
      scripts: scripts.length,
      stylesheets: stylesheets.length,
      forms,
      words: words.length,
      htmlBytes: Buffer.byteLength(artifacts.html, "utf8"),
    },
    snippet: pageText.slice(0, 420) || null,
    securityHeaders,
    technologyHints: collectTechnologyHints(html, artifacts.responseHeaders),
    recommendations,
  };
}

function renderKeyValueRows(rows) {
  return rows
    .map(function (row) {
      return "<tr><th>" + escapeHtml(row[0]) + "</th><td>" + escapeHtml(row[1]) + "</td></tr>";
    })
    .join("");
}

function renderList(items) {
  if (!items || items.length === 0) {
    return '<p class="empty">None</p>';
  }

  return "<ul>" + items.map(function (item) {
    return "<li>" + escapeHtml(item) + "</li>";
  }).join("") + "</ul>";
}

export function renderHtmlReport(report) {
  const diagnostics = report.diagnostics;
  const securityRows = [
    ["Content-Security-Policy", diagnostics.securityHeaders.contentSecurityPolicy ? "present" : "missing"],
    ["Strict-Transport-Security", diagnostics.securityHeaders.strictTransportSecurity ? "present" : "missing"],
    ["X-Frame-Options", diagnostics.securityHeaders.frameOptions ? "present" : "missing"],
    ["Referrer-Policy", diagnostics.securityHeaders.referrerPolicy ? "present" : "missing"],
    ["X-Content-Type-Options", diagnostics.securityHeaders.contentTypeOptions ? "present" : "missing"],
    ["Permissions-Policy", diagnostics.securityHeaders.permissionsPolicy ? "present" : "missing"],
  ];
  const metricRows = [
    ["Requested URL", report.targetUrl],
    ["Final URL", report.finalUrl],
    ["HTTP status", String(report.status)],
    ["Fetch duration", String(report.durationMs) + " ms"],
    ["Content-Type", report.contentType || "unknown"],
    ["HTML bytes", String(diagnostics.counts.htmlBytes)],
    ["Word count", String(diagnostics.counts.words)],
    ["Internal links", String(diagnostics.counts.internalLinks)],
    ["External links", String(diagnostics.counts.externalLinks)],
    ["Images", String(diagnostics.counts.images)],
    ["Scripts", String(diagnostics.counts.scripts)],
    ["Stylesheets", String(diagnostics.counts.stylesheets)],
    ["Forms", String(diagnostics.counts.forms)],
  ];
  const metadataRows = renderKeyValueRows([
    ["Title", diagnostics.title || "missing"],
    ["Meta description", diagnostics.metaDescription || "missing"],
    ["Meta robots", diagnostics.metaRobots || "missing"],
    ["OG title", diagnostics.ogTitle || "missing"],
    ["OG description", diagnostics.ogDescription || "missing"],
    ["Canonical", diagnostics.canonical || "missing"],
    ["HTML lang", diagnostics.htmlLang || "missing"],
    ["Viewport", diagnostics.viewport || "missing"],
  ]);
  const authRows = renderKeyValueRows([
    ["Configured", report.auth.configured ? "yes" : "no"],
    ["Header name", report.auth.headerName || "none"],
    ["Scheme", report.auth.scheme || "none"],
    ["Token length", report.auth.tokenLength == null ? "none" : String(report.auth.tokenLength)],
  ]);
  const companionRows = renderKeyValueRows([
    ["robots.txt", report.robots.ok ? "available (" + report.robots.status + ")" : "missing or unavailable"],
    ["sitemap.xml", report.sitemap.ok ? "available (" + report.sitemap.status + ")" : "missing or unavailable"],
  ]);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>Sandcastle Webpage Inspector</title>",
    "  <style>",
    "    :root { color-scheme: light; --bg: #f5f5f4; --panel: #ffffff; --text: #111827; --muted: #6b7280; --border: #e5e7eb; --accent: #0f172a; --good: #166534; --warn: #92400e; }",
    "    * { box-sizing: border-box; }",
    "    body { margin: 0; font-family: 'Geist Sans', 'Helvetica Neue', sans-serif; background: linear-gradient(180deg, #fafaf9 0%, #f3f4f6 100%); color: var(--text); }",
    "    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }",
    "    .hero { display: grid; gap: 18px; margin-bottom: 20px; }",
    "    .hero-card, section { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 22px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06); }",
    "    h1, h2, h3 { margin: 0 0 12px; line-height: 1.2; }",
    "    p { margin: 0 0 10px; line-height: 1.6; }",
    "    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }",
    "    .chip { border-radius: 999px; padding: 6px 10px; font-size: 0.88rem; border: 1px solid var(--border); background: #f8fafc; }",
    "    .grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 18px; margin-top: 18px; }",
    "    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }",
    "    th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid var(--border); vertical-align: top; }",
    "    th { width: 220px; color: var(--muted); font-weight: 500; }",
    "    pre { white-space: pre-wrap; word-break: break-word; background: #0f172a; color: #e5e7eb; padding: 16px; border-radius: 14px; overflow: auto; }",
    "    ul { margin: 0; padding-left: 18px; line-height: 1.7; }",
    "    .empty { color: var(--muted); font-style: italic; }",
    "    .status-ok { color: var(--good); }",
    "    .status-warn { color: var(--warn); }",
    "    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } th { width: 160px; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    '    <section class="hero-card hero">',
    "      <div>",
    "        <h1>Webpage inspection report</h1>",
    "        <p>Generated by the Sandcastle webpage inspector template.</p>",
    "        <div class=\"meta\">",
    "          <span class=\"chip\">Target: " + escapeHtml(report.targetUrl) + "</span>",
    "          <span class=\"chip\">Final: " + escapeHtml(report.finalUrl) + "</span>",
    "          <span class=\"chip\">Status: " + escapeHtml(String(report.status)) + "</span>",
    "          <span class=\"chip\">Fetched in " + escapeHtml(String(report.durationMs)) + " ms</span>",
    "          <span class=\"chip\">Generated at " + escapeHtml(report.generatedAt) + "</span>",
    "        </div>",
    "      </div>",
    report.focusNotes ? "      <p><strong>Audit focus:</strong> " + escapeHtml(report.focusNotes) + "</p>" : "",
    "    </section>",
    '    <div class="grid">',
    "      <section>",
    "        <h2>Document summary</h2>",
    "        <table><tbody>" + renderKeyValueRows(metricRows) + "</tbody></table>",
    "      </section>",
    "      <section>",
    "        <h2>Metadata</h2>",
    "        <table><tbody>" + metadataRows + "</tbody></table>",
    "      </section>",
    "    </div>",
    '    <div class="grid">',
    "      <section>",
    "        <h2>Headings and content</h2>",
    "        <h3>H1</h3>",
    "        " + renderList(diagnostics.headings.h1),
    "        <h3>H2</h3>",
    "        " + renderList(diagnostics.headings.h2),
    "        <h3>Text snippet</h3>",
    "        <pre>" + escapeHtml(diagnostics.snippet || "No readable text snippet available.") + "</pre>",
    "      </section>",
    "      <section>",
    "        <h2>Security headers</h2>",
    "        <table><tbody>" + renderKeyValueRows(securityRows) + "</tbody></table>",
    "        <h3>Auth configuration</h3>",
    "        <table><tbody>" + authRows + "</tbody></table>",
    "      </section>",
    "    </div>",
    '    <div class="grid">',
    "      <section>",
    "        <h2>Technology hints</h2>",
    "        " + renderList(diagnostics.technologyHints),
    "        <h3>Recommendations</h3>",
    "        " + renderList(diagnostics.recommendations),
    "      </section>",
    "      <section>",
    "        <h2>Companion resources</h2>",
    "        <table><tbody>" + companionRows + "</tbody></table>",
    "        <h3>robots.txt preview</h3>",
    "        <pre>" + escapeHtml(report.robots.preview || "No preview available.") + "</pre>",
    "        <h3>sitemap.xml preview</h3>",
    "        <pre>" + escapeHtml(report.sitemap.preview || "No preview available.") + "</pre>",
    "      </section>",
    "    </div>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildTextSummary(report) {
  const diagnostics = report.diagnostics;
  const lines = [
    "Target URL: " + report.targetUrl,
    "Final URL: " + report.finalUrl,
    "HTTP status: " + report.status,
    "Fetch duration: " + report.durationMs + " ms",
    "Title: " + (diagnostics.title || "missing"),
    "Meta description: " + (diagnostics.metaDescription || "missing"),
    "Canonical: " + (diagnostics.canonical || "missing"),
    "H1 count: " + diagnostics.headings.h1.length,
    "Internal links: " + diagnostics.counts.internalLinks,
    "External links: " + diagnostics.counts.externalLinks,
    "Images: " + diagnostics.counts.images,
    "Scripts: " + diagnostics.counts.scripts,
    "Words: " + diagnostics.counts.words,
    "Security headers: " + [
      diagnostics.securityHeaders.contentSecurityPolicy ? "CSP" : null,
      diagnostics.securityHeaders.strictTransportSecurity ? "HSTS" : null,
      diagnostics.securityHeaders.frameOptions ? "XFO" : null,
      diagnostics.securityHeaders.referrerPolicy ? "Referrer-Policy" : null,
      diagnostics.securityHeaders.contentTypeOptions ? "X-Content-Type-Options" : null,
      diagnostics.securityHeaders.permissionsPolicy ? "Permissions-Policy" : null,
    ].filter(Boolean).join(", "),
    "Recommendations:",
  ];

  if (diagnostics.recommendations.length === 0) {
    lines.push("- No high-signal recommendations were generated.");
  } else {
    for (const recommendation of diagnostics.recommendations) {
      lines.push("- " + recommendation);
    }
  }

  return lines.join("\n") + "\n";
}

export async function writeAuditArtifacts(report) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const summary = buildTextSummary(report);
  const html = renderHtmlReport(report);

  await fs.writeFile(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  await fs.writeFile(REPORT_JSON_PUBLIC_PATH, JSON.stringify(report, null, 2));
  await fs.writeFile(SUMMARY_PATH, summary);
  await fs.writeFile(TARGET_PATH, report.targetUrl + "\n");
  await fs.writeFile(REPORT_HTML_PATH, html);

  return {
    jsonPath: REPORT_JSON_PATH,
    summaryPath: SUMMARY_PATH,
    htmlPath: REPORT_HTML_PATH,
    publicJsonPath: REPORT_JSON_PUBLIC_PATH,
  };
}

export async function inspectWebpage(targetUrl, focusNotes = "", env = process.env) {
  const artifacts = await fetchPageArtifacts(targetUrl, env);
  const diagnostics = extractPageDiagnostics(artifacts);
  const auth = summarizeAuthConfig(env);
  const robots = await probeCompanionResource(artifacts.finalUrl, "/robots.txt", buildRequestHeaders(env));
  const sitemap = await probeCompanionResource(artifacts.finalUrl, "/sitemap.xml", buildRequestHeaders(env));

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl: artifacts.targetUrl,
    finalUrl: artifacts.finalUrl,
    status: artifacts.status,
    ok: artifacts.ok,
    durationMs: artifacts.durationMs,
    contentType: artifacts.contentType,
    focusNotes: String(focusNotes || "").trim() || null,
    auth,
    diagnostics,
    robots,
    sitemap,
  };

  const paths = await writeAuditArtifacts(report);
  return {
    report,
    paths,
    summary: buildTextSummary(report),
  };
}
`;
}

export function buildWebpageInspectorCli(): string {
  return String.raw`import process from "node:process";
import { inspectWebpage } from "./page-audit-lib.mjs";

async function main() {
  const targetUrl = process.argv[2];
  const focusNotes = process.argv.slice(3).join(" ").trim();

  if (!targetUrl) {
    console.error("Usage: node page-inspector.mjs <url> [focus notes]");
    process.exit(1);
  }

  const { report, paths, summary } = await inspectWebpage(targetUrl, focusNotes);
  console.log(summary.trim());
  console.log("");
  console.log("Artifacts:");
  console.log("- JSON: " + paths.jsonPath);
  console.log("- Summary: " + paths.summaryPath);
  console.log("- HTML: " + paths.htmlPath);
  console.log("- Final URL: " + report.finalUrl);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;
}

export function buildWebpageInspectorScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

template_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 1 ]]; then
  echo 'Usage: ./sandcastle-template/inspect-page.sh "https://example.com" [focus notes]' >&2
  exit 1
fi

target_url="$1"
shift || true
focus_notes="$*"

node "\${template_dir}/page-inspector.mjs" "\${target_url}" "\${focus_notes}"
`;
}

export function buildWebpageInspectorServeScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

template_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
report_dir="\${template_dir}/report-site"
port="\${1:-${WEBPAGE_INSPECTOR_PORT}}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to serve the report directory." >&2
  exit 1
fi

exec python3 -m http.server "\${port}" --directory "\${report_dir}" --bind 0.0.0.0
`;
}

export function buildWebpageInspectorShowSummaryScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

template_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
summary_file="\${template_dir}/output/latest-summary.txt"

if [[ ! -f "\${summary_file}" ]]; then
  echo "No summary exists yet. Run ./sandcastle-template/inspect-page.sh first." >&2
  exit 1
fi

cat "\${summary_file}"
`;
}
