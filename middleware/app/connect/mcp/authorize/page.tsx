import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { requireWebsiteUser } from "@/auth";
import Panel from "@/app/components/panel";
import PageShell from "@/app/components/page-shell";
import { McpOAuthError, validateMcpAuthorizationRequest } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Authorize MCP Client — Sandcastle",
  description: "Approve an MCP client to access your Sandcastle account.",
};

async function buildCurrentRequest(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const url = new URL(`${protocol}://${host}/connect/mcp/authorize`);

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  }

  return new Request(url);
}

function buildCallbackPath(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const url = new URL("https://sandcastle.invalid/connect/mcp/authorize");
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  }
  return url.pathname + url.search;
}

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const hasOAuthRequest = typeof params.client_id === "string";

  if (!hasOAuthRequest) {
    await requireWebsiteUser("/connect/mcp/authorize");

    return (
      <PageShell
        kicker="MCP"
        title="Authorization page"
        subtitle="This page is used during OAuth approval for a remote MCP client."
        actions={
          <Link href="/connect/mcp" className="button button--ghost button--small">
            Back to MCP connector
          </Link>
        }
      >
        <Panel
          title="No pending authorization request"
          description="Start the OAuth flow from your MCP client, then approve the request here."
        />
      </PageShell>
    );
  }

  const request = await buildCurrentRequest(params);
  let authorizationRequest;

  try {
    authorizationRequest = await validateMcpAuthorizationRequest(request, {
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      response_type: params.response_type,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      state: params.state,
      scope: params.scope,
      resource: params.resource,
    });
  } catch (error) {
    const message =
      error instanceof McpOAuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Invalid authorization request.";

    return (
      <PageShell
        kicker="MCP"
        title="Authorization request failed"
        subtitle={message}
        actions={
          <Link href="/connect/mcp" className="button button--ghost button--small">
            Back to MCP connector
          </Link>
        }
      >
        <div className="alert alert--error">{message}</div>
      </PageShell>
    );
  }

  await requireWebsiteUser(buildCallbackPath(params));

  return (
    <PageShell
      kicker="MCP"
      title="Authorize MCP client"
      subtitle="Review the client request before granting access to your Sandcastle account."
      actions={
        <Link href="/connect/mcp" className="button button--ghost button--small">
          Back to MCP connector
        </Link>
      }
    >
      <div className="detail-grid detail-grid--connect">
        <Panel
          title={authorizationRequest.client.client_name ?? authorizationRequest.client.client_id}
          description="This client is requesting access to your owned Sandcastle sandboxes."
        >
          <dl className="key-value-list">
            <div>
              <dt>Client ID</dt>
              <dd>{authorizationRequest.client.client_id}</dd>
            </div>
            <div>
              <dt>Redirect URI</dt>
              <dd>{authorizationRequest.redirectUri}</dd>
            </div>
            <div>
              <dt>Resource</dt>
              <dd>{authorizationRequest.resource}</dd>
            </div>
            <div>
              <dt>Scopes</dt>
              <dd>{authorizationRequest.scopes.join(" ")}</dd>
            </div>
          </dl>

          <form action="/api/mcp/oauth/authorize" method="post" className="connector-approval-form">
            <input type="hidden" name="client_id" value={authorizationRequest.client.client_id} />
            <input type="hidden" name="redirect_uri" value={authorizationRequest.redirectUri} />
            <input type="hidden" name="response_type" value="code" />
            <input type="hidden" name="code_challenge" value={authorizationRequest.codeChallenge} />
            <input type="hidden" name="code_challenge_method" value={authorizationRequest.codeChallengeMethod} />
            <input type="hidden" name="scope" value={authorizationRequest.scopes.join(" ")} />
            <input type="hidden" name="resource" value={authorizationRequest.resource} />
            {authorizationRequest.state && (
              <input type="hidden" name="state" value={authorizationRequest.state} />
            )}

            <div className="connector-approval-form__actions">
              <button
                type="submit"
                name="decision"
                value="deny"
                className="button button--ghost"
              >
                Deny
              </button>
              <button
                type="submit"
                name="decision"
                value="approve"
                className="button button--primary"
              >
                Approve access
              </button>
            </div>
          </form>
        </Panel>

        <div className="side-rail">
          <Panel
            title="What this grants"
            description="The MCP client will be able to act as you within the current Sandcastle MCP scope."
          >
            <ul className="connector-card__capabilities connector-card__capabilities--compact">
              <li>List templates and owned sandboxes</li>
              <li>Launch a new sandbox</li>
              <li>Inspect files, previews, tasks, and logs</li>
              <li>Stop an owned sandbox</li>
            </ul>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
