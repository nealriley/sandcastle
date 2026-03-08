import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireWebsiteUser } from "@/auth";
import Panel from "@/app/components/panel";
import PageShell from "@/app/components/page-shell";
import ConnectCode from "@/app/components/connect-code";
import { getConnector } from "@/lib/connectors";
import { getOrCreatePairingCode } from "@/lib/pairing";
import { isRateLimitError } from "@/lib/rate-limit";
import {
  buildMcpAuthorizationMetadataUrl,
  buildMcpProtectedResourceMetadataUrl,
  buildMcpServerUrl,
} from "@/lib/url";

export const dynamic = "force-dynamic";

type McpClientGuide = {
  name: string;
  clientType: string;
  summary: string;
  command?: string;
  steps: string[];
  note?: string;
  docsHref: string;
  docsLabel: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ connectorSlug: string }>;
}): Promise<Metadata> {
  const { connectorSlug } = await params;
  const connector = getConnector(connectorSlug);

  return {
    title: connector ? `${connector.name} — Sandcastle` : "Connector Not Found — Sandcastle",
    description: connector?.summary,
  };
}

function BackToConnectorsLink() {
  return (
    <Link href="/connect" className="button button--ghost button--small">
      Back to connectors
    </Link>
  );
}

async function buildCurrentRequest(pathname: string): Promise<Request> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return new Request(`${protocol}://${host}${pathname}`);
}

async function ShgoConnectorDetail() {
  const user = await requireWebsiteUser("/connect/shgo");

  try {
    const pairing = await getOrCreatePairingCode(user);

    return (
      <PageShell
        kicker="Connector"
        title="Superhuman Go"
        subtitle="Authenticate Pack actions with a short-lived pairing code."
        actions={<BackToConnectorsLink />}
      >
        <div className="detail-grid detail-grid--connect">
          <Panel>
            <ConnectCode code={pairing.code} expiresAt={pairing.expiresAt} />

            <div className="connect-instructions">
              <p>1. Keep this page open while you work with Superhuman Go.</p>
              <p>2. Paste the code when the Pack asks to authenticate a sandbox action.</p>
              <p>3. Use the website for dashboard, logs, previews, and environment management.</p>
            </div>
          </Panel>

          <div className="side-rail">
            <Panel
              title="What this unlocks"
              description="The Pack redeems the code once, then Sandcastle keeps ownership checks on the server."
            >
              <ul className="connector-card__capabilities connector-card__capabilities--compact">
                <li>Launch sandboxes from Pack chat</li>
                <li>List your owned sandboxes</li>
                <li>Resume an owned sandbox by id</li>
              </ul>
            </Panel>

            <Panel
              title="Important behavior"
              description="Codes expire quickly and are single-use for creation and resume flows."
            >
              <dl className="key-value-list">
                <div>
                  <dt>Auth model</dt>
                  <dd>GitHub sign-in + one-time pairing code</dd>
                </div>
                <div>
                  <dt>Compatibility URL</dt>
                  <dd>/connector</dd>
                </div>
              </dl>
            </Panel>
          </div>
        </div>
      </PageShell>
    );
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    return (
      <PageShell
        kicker="Connector"
        title="Superhuman Go"
        subtitle={error.message}
        actions={<BackToConnectorsLink />}
      >
        <div className="alert alert--error">
          Try again in about {error.retryAfterSeconds} seconds. This limit keeps
          connect-code generation abuse-resistant.
        </div>
      </PageShell>
    );
  }
}

async function McpConnectorDetail() {
  await requireWebsiteUser("/connect/mcp");

  const request = await buildCurrentRequest("/connect/mcp");
  const endpoint = buildMcpServerUrl(request);
  const protectedResourceMetadata = buildMcpProtectedResourceMetadataUrl(request);
  const authorizationMetadata = buildMcpAuthorizationMetadataUrl(request);
  const clientGuides: McpClientGuide[] = [
    {
      name: "Claude Code",
      clientType: "Local client",
      summary: "Recommended local setup for Anthropic's desktop and terminal coding agent.",
      command: `claude mcp add --transport http sandcastle ${endpoint}`,
      steps: [
        "Install or update Claude Code on your machine.",
        "Run the command below to register Sandcastle as a remote MCP server.",
        "Start Claude Code, run /mcp, choose sandcastle, and complete GitHub OAuth in your browser.",
      ],
      docsHref: "https://docs.anthropic.com/en/docs/claude-code/mcp",
      docsLabel: "Claude Code MCP docs",
    },
    {
      name: "claude.ai",
      clientType: "Web app",
      summary: "Use Claude's custom connector flow if your plan exposes remote MCP connectors.",
      steps: [
        "Open Claude, then go to Settings and open the Connectors area.",
        "Add a custom connector and paste the Sandcastle server URL from this page.",
        "Approve the OAuth request in your browser to bind the connector to your Sandcastle account.",
      ],
      note:
        "This is an inferred setup path from Anthropic's current connector and remote MCP docs. The exact menu label can vary by plan and rollout.",
      docsHref: "https://support.anthropic.com/en/articles/11175166-use-integrations-in-claude",
      docsLabel: "Claude integrations guide",
    },
    {
      name: "Codex",
      clientType: "Local client",
      summary: "Recommended local setup for the Codex CLI using a remote MCP server URL.",
      command: `codex mcp add sandcastle --url ${endpoint}`,
      steps: [
        "Install or update the Codex CLI on your machine.",
        "Run the command below to register Sandcastle as an MCP server.",
        "Start Codex, confirm the server appears in codex mcp list if needed, and finish the OAuth approval flow in your browser.",
      ],
      docsHref: "https://platform.openai.com/docs/codex/mcp",
      docsLabel: "Codex MCP docs",
    },
    {
      name: "ChatGPT",
      clientType: "Web app",
      summary: "ChatGPT connects to Sandcastle as a remote custom connector, not a local stdio server.",
      steps: [
        "Turn on Developer Mode in ChatGPT if your plan requires it for custom connectors.",
        "Open the custom connector flow in ChatGPT and add a remote MCP server using the Sandcastle URL from this page.",
        "Complete GitHub OAuth in your browser, then use Sandcastle tools from within ChatGPT.",
      ],
      note:
        "OpenAI's current custom connector path is remote-MCP-based. Sandcastle is compatible because it exposes HTTPS transport plus OAuth metadata.",
      docsHref: "https://help.openai.com/en/articles/11487775-connectors-in-chatgpt",
      docsLabel: "ChatGPT connectors guide",
    },
  ];

  return (
    <PageShell
      kicker="Connector"
      title="Model Context Protocol"
      subtitle="Remote MCP access for Sandcastle using OAuth and Streamable HTTP."
      actions={<BackToConnectorsLink />}
    >
      <div className="detail-grid detail-grid--connect">
        <div className="detail-column">
          <Panel
            title="How to connect"
            description="Sandcastle runs as a remote MCP server over HTTPS. For Claude Code and Codex you configure the client locally. For Claude and ChatGPT web apps you add Sandcastle as a remote connector."
          >
            <div className="connector-endpoint-list">
              <div className="connector-endpoint">
                <span className="connector-endpoint__label">Server URL</span>
                <code>{endpoint}</code>
              </div>
              <div className="connector-endpoint">
                <span className="connector-endpoint__label">Protected resource metadata</span>
                <code>{protectedResourceMetadata}</code>
              </div>
              <div className="connector-endpoint">
                <span className="connector-endpoint__label">Authorization metadata</span>
                <code>{authorizationMetadata}</code>
              </div>
            </div>

            <div className="connect-instructions">
              <p>1. Add Sandcastle to a remote-MCP-capable client using the server URL above.</p>
              <p>2. When the client begins OAuth, sign in with GitHub and approve Sandcastle access.</p>
              <p>3. After approval the client can list templates, launch sandboxes, inspect files and previews, and stop an owned sandbox.</p>
            </div>
          </Panel>

          <Panel
            title="Recommended client setup"
            description="These are the current setup paths for the clients we support today."
          >
            <div className="connector-client-grid">
              {clientGuides.map((guide) => (
                <article key={guide.name} className="connector-client-card">
                  <div className="connector-client-card__header">
                    <div>
                      <h3 className="connector-client-card__title">{guide.name}</h3>
                      <p className="connector-client-card__summary">{guide.summary}</p>
                    </div>
                    <span className="status-badge status-badge--muted">{guide.clientType}</span>
                  </div>

                  {guide.command ? (
                    <pre className="connector-command">
                      <code>{guide.command}</code>
                    </pre>
                  ) : null}

                  <ol className="connector-steps">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  {guide.note ? <p className="connector-client-card__note">{guide.note}</p> : null}

                  <a
                    href={guide.docsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="connector-client-card__link"
                  >
                    {guide.docsLabel}
                  </a>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <div className="side-rail">
          <Panel
            title="Auth model"
            description="MCP uses OAuth authorization code flow. Sandcastle binds the issued token to your website identity and owned resources."
          >
            <dl className="key-value-list">
              <div>
                <dt>Transport</dt>
                <dd>Streamable HTTP</dd>
              </div>
              <div>
                <dt>Access scope</dt>
                <dd>mcp</dd>
              </div>
              <div>
                <dt>Identity source</dt>
                <dd>GitHub website sign-in</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="V1 tools"
            description="The MCP server is scoped to owned-sandbox workflows for now."
          >
            <ul className="connector-card__capabilities connector-card__capabilities--compact">
              <li>List templates and owned sandboxes</li>
              <li>Launch a sandbox from a template</li>
              <li>Inspect tasks, files, logs, and previews</li>
              <li>Stop an owned sandbox</li>
            </ul>
          </Panel>

          <Panel
            title="Approval route"
            description="OAuth consent is completed in your browser."
          >
            <Link
              href="/connect/mcp/authorize"
              className="button button--secondary button--small"
            >
              Open authorization page
            </Link>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ connectorSlug: string }>;
}) {
  const { connectorSlug } = await params;

  if (connectorSlug === "shgo") {
    return ShgoConnectorDetail();
  }

  if (connectorSlug === "mcp") {
    return McpConnectorDetail();
  }

  notFound();
}
