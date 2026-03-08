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

  return (
    <PageShell
      kicker="Connector"
      title="Model Context Protocol"
      subtitle="Remote MCP access for Sandcastle using OAuth and Streamable HTTP."
      actions={<BackToConnectorsLink />}
    >
      <div className="detail-grid detail-grid--connect">
        <Panel
          title="How to connect"
          description="Use the MCP endpoint in a client that supports remote MCP. If your client is stdio-only, bridge it with a remote MCP adapter."
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
            <p>1. Point your remote MCP client at the server URL above.</p>
            <p>2. When the client begins OAuth, sign in with GitHub and approve Sandcastle access.</p>
            <p>3. The client can then list templates, launch sandboxes, inspect files and previews, and stop an owned sandbox.</p>
          </div>
        </Panel>

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
