import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import type { NextAuthOptions, Session } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export interface WebsiteUser {
  id: string;
  login: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface WebsiteAuthConfig {
  secret: string;
  github: {
    clientId: string;
    clientSecret: string;
  };
}

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | null {
  return values.find((candidate) => candidate && candidate.trim()) ?? null;
}

function getGithubConfig() {
  const clientId = firstNonEmpty(
    process.env.AUTH_GITHUB_ID,
    process.env.GITHUB_ID
  );
  const clientSecret = firstNonEmpty(
    process.env.AUTH_GITHUB_SECRET,
    process.env.GITHUB_SECRET
  );

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

function hasAnyWebsiteAuthEnv(): boolean {
  return Boolean(
    firstNonEmpty(
      process.env.AUTH_SECRET,
      process.env.NEXTAUTH_SECRET,
      process.env.AUTH_GITHUB_ID,
      process.env.GITHUB_ID,
      process.env.AUTH_GITHUB_SECRET,
      process.env.GITHUB_SECRET
    )
  );
}

export function getWebsiteAuthConfigurationError(): string | null {
  const missing: string[] = [];

  const secret = firstNonEmpty(process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET);
  if (!secret) {
    missing.push("AUTH_SECRET");
  }

  const clientId = firstNonEmpty(
    process.env.AUTH_GITHUB_ID,
    process.env.GITHUB_ID
  );
  if (!clientId) {
    missing.push("AUTH_GITHUB_ID");
  }

  const clientSecret = firstNonEmpty(
    process.env.AUTH_GITHUB_SECRET,
    process.env.GITHUB_SECRET
  );
  if (!clientSecret) {
    missing.push("AUTH_GITHUB_SECRET");
  }

  if (missing.length === 0) {
    return null;
  }

  const prefix = hasAnyWebsiteAuthEnv()
    ? "Website auth is partially configured."
    : "Website auth is not configured.";

  return `${prefix} Missing ${missing.join(", ")}.`;
}

export function isWebsiteAuthConfigured(): boolean {
  return getWebsiteAuthConfigurationError() === null;
}

export class WebsiteAuthConfigurationError extends Error {
  override name = "WebsiteAuthConfigurationError";
}

export function assertWebsiteAuthConfigured(): WebsiteAuthConfig {
  const issue = getWebsiteAuthConfigurationError();
  if (issue) {
    throw new WebsiteAuthConfigurationError(issue);
  }

  const secret = firstNonEmpty(process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET);
  const github = getGithubConfig();
  if (!secret || !github) {
    throw new WebsiteAuthConfigurationError(
      "Website auth configuration is incomplete."
    );
  }

  return {
    secret,
    github,
  };
}

export function getAuthOptions(): NextAuthOptions {
  const config = assertWebsiteAuthConfigured();

  return {
    secret: config.secret,
    session: {
      strategy: "jwt",
    },
    pages: {
      signIn: "/signin",
    },
    providers: [
      GitHubProvider({
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret,
      }),
    ],
    callbacks: {
      async jwt({ token, profile }) {
        if (profile && typeof profile === "object") {
          const githubLogin =
            "login" in profile && typeof profile.login === "string"
              ? profile.login
              : null;
          if (githubLogin) {
            token.login = githubLogin;
          }
        }
        return token;
      },
      async session({ session, token }) {
        const nextSession = session as Session & {
          user?: Session["user"] & { id?: string; login?: string | null };
        };

        if (nextSession.user) {
          nextSession.user.id = token.sub ?? "";
          nextSession.user.login =
            typeof token.login === "string" ? token.login : null;
        }

        return nextSession;
      },
    },
  };
}

function ensureWebsiteAuthConfigured() {
  assertWebsiteAuthConfigured();
}

export async function auth() {
  ensureWebsiteAuthConfigured();
  return getServerSession(getAuthOptions());
}

export function extractWebsiteUser(
  session: Session | null
): WebsiteUser | null {
  const user = session?.user as
    | (Session["user"] & { id?: string; login?: string | null })
    | undefined;

  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    login: user.login ?? null,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
  };
}

export async function getWebsiteUser(): Promise<WebsiteUser | null> {
  return extractWebsiteUser(await auth());
}

export async function requireWebsiteUser(callbackPath = "/sandboxes") {
  ensureWebsiteAuthConfigured();

  const user = await getWebsiteUser();
  if (user) {
    return user;
  }

  const callbackUrl = encodeURIComponent(callbackPath);
  redirect(`/signin?callbackUrl=${callbackUrl}`);
}
