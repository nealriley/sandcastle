import NextAuth from "next-auth/next";
import {
  getAuthOptions,
  getWebsiteAuthConfigurationError,
} from "@/auth";

export const dynamic = "force-dynamic";

function authConfigurationResponse() {
  return Response.json(
    {
      error:
        getWebsiteAuthConfigurationError() ??
        "Website auth is not configured correctly.",
    },
    { status: 500 }
  );
}

export async function GET(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  if (getWebsiteAuthConfigurationError()) {
    return authConfigurationResponse();
  }
  const handler = NextAuth(getAuthOptions());
  return handler(req, context);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  if (getWebsiteAuthConfigurationError()) {
    return authConfigurationResponse();
  }
  const handler = NextAuth(getAuthOptions());
  return handler(req, context);
}
