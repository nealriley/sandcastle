import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { WebsiteUser } from "@/auth";
import { getRedis } from "./redis";
import {
  buildMcpAuthorizationServerUrl,
  buildMcpServerUrl,
} from "./url";

type AuthInfo = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra?: Record<string, unknown>;
};

type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  service_documentation?: string;
  revocation_endpoint?: string;
  client_id_metadata_document_supported?: boolean;
};

const MCP_SCOPE = "mcp";
const SUPPORTED_SCOPES = [MCP_SCOPE] as const;
const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

type McpAuthRedis = {
  del(key: string): Promise<number>;
  get<T>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean }
  ): Promise<unknown>;
};

export type McpClientRecord = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  scope: string;
  client_id_issued_at: number;
  client_secret_expires_at: 0;
};

type McpAuthorizationCodeRecord = {
  code: string;
  clientId: string;
  ownerUserId: string;
  ownerLogin: string | null;
  redirectUri: string;
  scopes: string[];
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: number;
  expiresAt: number;
};

type McpAccessTokenRecord = {
  token: string;
  clientId: string;
  ownerUserId: string;
  ownerLogin: string | null;
  scopes: string[];
  resource: string;
  createdAt: number;
  expiresAt: number;
};

export type McpAuthorizationRequest = {
  client: McpClientRecord;
  redirectUri: string;
  scopes: string[];
  state: string | null;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

export class McpOAuthError extends Error {
  readonly status: number;
  readonly oauthError: string;
  readonly redirectUri: string | null;
  readonly state: string | null;

  constructor(args: {
    status: number;
    error: string;
    message: string;
    redirectUri?: string | null;
    state?: string | null;
  }) {
    super(args.message);
    this.name = "McpOAuthError";
    this.status = args.status;
    this.oauthError = args.error;
    this.redirectUri = args.redirectUri ?? null;
    this.state = args.state ?? null;
  }
}

function clientKey(clientId: string): string {
  return `mcp:oauth:client:${clientId}`;
}

function codeKey(code: string): string {
  return `mcp:oauth:code:${code}`;
}

function tokenKey(token: string): string {
  return `mcp:oauth:token:${token}`;
}

function requireString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_request",
      message: `${field} must be a string.`,
    });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_request",
      message: `${field} is required.`,
    });
  }

  if (trimmed.length > maxLength) {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_request",
      message: `${field} exceeds the maximum length of ${maxLength} characters.`,
    });
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
    throw new McpOAuthError({
      status: 400,
      error: "invalid_request",
      message: `${field} must be a string.`,
    });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_request",
      message: `${field} exceeds the maximum length of ${maxLength} characters.`,
    });
  }

  return trimmed;
}

function normalizeRedirectUri(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_redirect_uri",
      message: "redirect_uri must be an absolute URL.",
    });
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol === "javascript:" || protocol === "data:") {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_redirect_uri",
      message: "redirect_uri protocol is not allowed.",
    });
  }

  return url.toString();
}

function normalizeScopes(scopeValue: string | null): string[] {
  if (!scopeValue) {
    return [MCP_SCOPE];
  }

  const scopes = [...new Set(scopeValue.split(/\s+/).filter(Boolean))];
  if (scopes.length === 0) {
    return [MCP_SCOPE];
  }

  const unsupported = scopes.filter((scope) => !SUPPORTED_SCOPES.includes(scope as typeof MCP_SCOPE));
  if (unsupported.length > 0) {
    throw new McpOAuthError({
      status: 400,
      error: "invalid_scope",
      message: `Unsupported scopes requested: ${unsupported.join(", ")}.`,
    });
  }

  return scopes;
}

function compareVerifier(
  verifier: string,
  expectedChallenge: string
): boolean {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const expectedBytes = Buffer.from(expectedChallenge);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function buildError(
  status: number,
  error: string,
  message: string,
  redirectUri?: string | null,
  state?: string | null
): McpOAuthError {
  return new McpOAuthError({
    status,
    error,
    message,
    redirectUri,
    state,
  });
}

export function getMcpSupportedScopes(): string[] {
  return [...SUPPORTED_SCOPES];
}

export function getMcpOAuthMetadata(req: Request): OAuthMetadata {
  return {
    issuer: buildMcpAuthorizationServerUrl(req),
    authorization_endpoint: `${buildMcpAuthorizationServerUrl(req)}/authorize`,
    token_endpoint: `${buildMcpAuthorizationServerUrl(req)}/token`,
    registration_endpoint: `${buildMcpAuthorizationServerUrl(req)}/register`,
    revocation_endpoint: `${buildMcpAuthorizationServerUrl(req)}/revoke`,
    scopes_supported: getMcpSupportedScopes(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${new URL("/connect/mcp", buildMcpServerUrl(req)).toString()}`,
    client_id_metadata_document_supported: false,
  };
}

export async function registerMcpOAuthClient(
  input: unknown
): Promise<McpClientRecord> {
  return registerMcpOAuthClientForRedis(getRedis(), input);
}

export async function registerMcpOAuthClientForRedis(
  redis: McpAuthRedis,
  input: unknown
): Promise<McpClientRecord> {
  if (!input || typeof input !== "object") {
    throw buildError(400, "invalid_client_metadata", "Client metadata must be an object.");
  }

  const rawRedirectUris = (input as { redirect_uris?: unknown }).redirect_uris;
  if (!Array.isArray(rawRedirectUris) || rawRedirectUris.length === 0) {
    throw buildError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must contain at least one URI."
    );
  }

  const redirectUris = rawRedirectUris.map((value) =>
    normalizeRedirectUri(requireString(value, "redirect_uri", 2_000))
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const record: McpClientRecord = {
    client_id: `mcp_client_${randomUUID()}`,
    client_name: optionalString(
      (input as { client_name?: unknown }).client_name,
      "client_name",
      120
    ),
    redirect_uris: [...new Set(redirectUris)],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: MCP_SCOPE,
    client_id_issued_at: nowSeconds,
    client_secret_expires_at: 0,
  };

  await redis.set(clientKey(record.client_id), record);
  return record;
}

export async function getMcpOAuthClient(
  clientId: string
): Promise<McpClientRecord | null> {
  return getMcpOAuthClientForRedis(getRedis(), clientId);
}

export async function getMcpOAuthClientForRedis(
  redis: McpAuthRedis,
  clientId: string
): Promise<McpClientRecord | null> {
  return redis.get<McpClientRecord>(clientKey(clientId));
}

export async function validateMcpAuthorizationRequest(
  req: Request,
  input: {
    client_id?: unknown;
    redirect_uri?: unknown;
    response_type?: unknown;
    code_challenge?: unknown;
    code_challenge_method?: unknown;
    state?: unknown;
    scope?: unknown;
    resource?: unknown;
  }
): Promise<McpAuthorizationRequest> {
  return validateMcpAuthorizationRequestForRedis(getRedis(), req, input);
}

export async function validateMcpAuthorizationRequestForRedis(
  redis: McpAuthRedis,
  req: Request,
  input: {
    client_id?: unknown;
    redirect_uri?: unknown;
    response_type?: unknown;
    code_challenge?: unknown;
    code_challenge_method?: unknown;
    state?: unknown;
    scope?: unknown;
    resource?: unknown;
  }
): Promise<McpAuthorizationRequest> {
  const clientId = requireString(input.client_id, "client_id", 200);
  const client = await getMcpOAuthClientForRedis(redis, clientId);
  if (!client) {
    throw buildError(400, "unauthorized_client", "Unknown client_id.");
  }

  const redirectUri = normalizeRedirectUri(
    requireString(input.redirect_uri, "redirect_uri", 2_000)
  );
  if (!client.redirect_uris.includes(redirectUri)) {
    throw buildError(
      400,
      "invalid_redirect_uri",
      "redirect_uri was not registered for this client.",
      redirectUri,
      optionalString(input.state, "state", 500)
    );
  }

  const responseType = requireString(input.response_type, "response_type", 50);
  if (responseType !== "code") {
    throw buildError(
      400,
      "unsupported_response_type",
      "Only response_type=code is supported.",
      redirectUri,
      optionalString(input.state, "state", 500)
    );
  }

  const codeChallenge = requireString(
    input.code_challenge,
    "code_challenge",
    512
  );
  const codeChallengeMethod = requireString(
    input.code_challenge_method ?? "S256",
    "code_challenge_method",
    20
  );
  if (codeChallengeMethod !== "S256") {
    throw buildError(
      400,
      "invalid_request",
      "Only code_challenge_method=S256 is supported.",
      redirectUri,
      optionalString(input.state, "state", 500)
    );
  }

  const state = optionalString(input.state, "state", 500);
  const resourceInput = optionalString(input.resource, "resource", 2_000);
  const expectedResource = buildMcpServerUrl(req);
  const resource = resourceInput ?? expectedResource;
  if (resource !== expectedResource) {
    throw buildError(
      400,
      "invalid_target",
      "The requested resource is not supported.",
      redirectUri,
      state
    );
  }

  const scopeValue = optionalString(input.scope, "scope", 1_000);
  const scopes = normalizeScopes(scopeValue);

  return {
    client,
    redirectUri,
    scopes,
    state,
    resource,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export async function issueMcpAuthorizationCode(
  request: McpAuthorizationRequest,
  user: WebsiteUser
): Promise<string> {
  return issueMcpAuthorizationCodeForRedis(getRedis(), request, user);
}

export async function issueMcpAuthorizationCodeForRedis(
  redis: McpAuthRedis,
  request: McpAuthorizationRequest,
  user: WebsiteUser
): Promise<string> {
  const code = `mcp_code_${randomUUID()}`;
  const now = Date.now();
  const record: McpAuthorizationCodeRecord = {
    code,
    clientId: request.client.client_id,
    ownerUserId: user.id,
    ownerLogin: user.login ?? null,
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    resource: request.resource,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod,
    createdAt: now,
    expiresAt: now + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
  };

  await redis.set(codeKey(code), record, { ex: AUTHORIZATION_CODE_TTL_SECONDS });
  return code;
}

export function buildMcpAuthorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function buildMcpAuthorizationErrorRedirect(
  error: McpOAuthError
): string | null {
  if (!error.redirectUri) {
    return null;
  }

  return buildMcpAuthorizationRedirect(error.redirectUri, {
    error: error.oauthError,
    error_description: error.message,
    state: error.state,
  });
}

export async function exchangeMcpAuthorizationCode(
  req: Request,
  formData: FormData
): Promise<{
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  scope: string;
}> {
  return exchangeMcpAuthorizationCodeForRedis(getRedis(), req, formData);
}

export async function exchangeMcpAuthorizationCodeForRedis(
  redis: McpAuthRedis,
  req: Request,
  formData: FormData
): Promise<{
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  scope: string;
}> {
  const grantType = requireString(formData.get("grant_type"), "grant_type", 80);
  if (grantType !== "authorization_code") {
    throw buildError(400, "unsupported_grant_type", "Only authorization_code is supported.");
  }

  const clientId = requireString(formData.get("client_id"), "client_id", 200);
  const client = await getMcpOAuthClientForRedis(redis, clientId);
  if (!client) {
    throw buildError(401, "invalid_client", "Unknown client_id.");
  }

  const code = requireString(formData.get("code"), "code", 300);
  const codeRecord = await redis.get<McpAuthorizationCodeRecord>(codeKey(code));
  if (!codeRecord || codeRecord.expiresAt <= Date.now()) {
    throw buildError(400, "invalid_grant", "Authorization code is invalid or expired.");
  }

  if (codeRecord.clientId !== client.client_id) {
    throw buildError(400, "invalid_grant", "Authorization code was not issued to this client.");
  }

  const redirectUri = normalizeRedirectUri(
    requireString(formData.get("redirect_uri"), "redirect_uri", 2_000)
  );
  if (redirectUri !== codeRecord.redirectUri) {
    throw buildError(400, "invalid_grant", "redirect_uri does not match the original authorization request.");
  }

  const codeVerifier = requireString(
    formData.get("code_verifier"),
    "code_verifier",
    512
  );
  if (!compareVerifier(codeVerifier, codeRecord.codeChallenge)) {
    throw buildError(400, "invalid_grant", "code_verifier is invalid.");
  }

  const resource = optionalString(formData.get("resource"), "resource", 2_000);
  const expectedResource = buildMcpServerUrl(req);
  if ((resource ?? codeRecord.resource) !== expectedResource) {
    throw buildError(400, "invalid_target", "The requested resource is not supported.");
  }

  const token = `mcp_tok_${randomUUID()}`;
  const now = Date.now();
  const tokenRecord: McpAccessTokenRecord = {
    token,
    clientId: client.client_id,
    ownerUserId: codeRecord.ownerUserId,
    ownerLogin: codeRecord.ownerLogin,
    scopes: codeRecord.scopes,
    resource: codeRecord.resource,
    createdAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
  };

  await redis.del(codeKey(code));
  await redis.set(tokenKey(token), tokenRecord, { ex: ACCESS_TOKEN_TTL_SECONDS });

  return {
    access_token: token,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: tokenRecord.scopes.join(" "),
  };
}

export async function revokeMcpAccessToken(token: string): Promise<void> {
  await revokeMcpAccessTokenForRedis(getRedis(), token);
}

export async function revokeMcpAccessTokenForRedis(
  redis: McpAuthRedis,
  token: string
): Promise<void> {
  await redis.del(tokenKey(token));
}

export async function verifyMcpAccessToken(
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  return verifyMcpAccessTokenForRedis(getRedis(), req, bearerToken);
}

export async function verifyMcpAccessTokenForRedis(
  redis: McpAuthRedis,
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    return undefined;
  }

  const tokenRecord = await redis.get<McpAccessTokenRecord>(tokenKey(bearerToken));
  if (!tokenRecord || tokenRecord.expiresAt <= Date.now()) {
    throw buildError(401, "invalid_token", "Access token is invalid or expired.");
  }

  const expectedResource = buildMcpServerUrl(req);
  if (tokenRecord.resource !== expectedResource) {
    throw buildError(403, "insufficient_scope", "Access token is not valid for this MCP resource.");
  }

  return {
    token: tokenRecord.token,
    clientId: tokenRecord.clientId,
    scopes: tokenRecord.scopes,
    expiresAt: Math.floor(tokenRecord.expiresAt / 1000),
    resource: new URL(tokenRecord.resource),
    extra: {
      ownerUserId: tokenRecord.ownerUserId,
      ownerLogin: tokenRecord.ownerLogin,
    },
  };
}
