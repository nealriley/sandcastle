import { NextResponse } from "next/server";
import { getWebsiteUser } from "@/auth";
import {
  McpOAuthError,
  buildMcpAuthorizationErrorRedirect,
  buildMcpAuthorizationRedirect,
  issueMcpAuthorizationCode,
  validateMcpAuthorizationRequest,
} from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildConsentPageUrl(req: Request): string {
  return new URL("/connect/mcp/authorize", req.url).toString();
}

function buildSignInUrl(req: Request, formData?: FormData): string {
  const callback = new URL("/connect/mcp/authorize", req.url);

  if (formData) {
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        callback.searchParams.set(key, value);
      }
    }
  } else {
    const current = new URL(req.url);
    callback.search = current.search;
  }

  return new URL(
    `/signin?callbackUrl=${encodeURIComponent(
      callback.pathname + callback.search
    )}`,
    req.url
  ).toString();
}

export async function GET(req: Request) {
  const current = new URL(req.url);
  const target = new URL(buildConsentPageUrl(req));
  target.search = current.search;
  return NextResponse.redirect(target, 302);
}

export async function POST(req: Request) {
  const formData = await req.formData();

  let authorizationRequest;
  try {
    authorizationRequest = await validateMcpAuthorizationRequest(req, {
      client_id: formData.get("client_id"),
      redirect_uri: formData.get("redirect_uri"),
      response_type: formData.get("response_type"),
      code_challenge: formData.get("code_challenge"),
      code_challenge_method: formData.get("code_challenge_method"),
      state: formData.get("state"),
      scope: formData.get("scope"),
      resource: formData.get("resource"),
    });
  } catch (error) {
    if (error instanceof McpOAuthError) {
      const redirectTarget = buildMcpAuthorizationErrorRedirect(error);
      if (redirectTarget) {
        return NextResponse.redirect(redirectTarget, 302);
      }

      return NextResponse.redirect(buildConsentPageUrl(req), 302);
    }

    throw error;
  }

  const user = await getWebsiteUser();
  if (!user) {
    return NextResponse.redirect(buildSignInUrl(req, formData), 302);
  }

  const decision =
    typeof formData.get("decision") === "string"
      ? (formData.get("decision") as string).trim().toLowerCase()
      : "deny";

  if (decision !== "approve") {
    return NextResponse.redirect(
      buildMcpAuthorizationRedirect(authorizationRequest.redirectUri, {
        error: "access_denied",
        error_description: "The user denied the authorization request.",
        state: authorizationRequest.state,
      }),
      302
    );
  }

  const code = await issueMcpAuthorizationCode(authorizationRequest, user);
  return NextResponse.redirect(
    buildMcpAuthorizationRedirect(authorizationRequest.redirectUri, {
      code,
      state: authorizationRequest.state,
    }),
    302
  );
}
