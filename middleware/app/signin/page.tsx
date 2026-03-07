import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BrandLogo from "../brand-logo";
import GitHubSignInButton from "../github-sign-in-button";
import {
  getWebsiteAuthConfigurationError,
  getWebsiteUser,
  isWebsiteAuthConfigured,
} from "@/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign In — Sandcastle",
  description:
    "Sign in with GitHub to own sandboxes, launch templates, and connect SuperHuman Go to Sandcastle.",
};

function resolveCallbackUrl(callbackUrl?: string): string {
  if (!callbackUrl || !callbackUrl.startsWith("/")) {
    return "/sandboxes";
  }

  return callbackUrl;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const nextPath = resolveCallbackUrl(callbackUrl);
  const authConfigured = isWebsiteAuthConfigured();
  const authIssue = authConfigured
    ? null
    : getWebsiteAuthConfigurationError();
  const user = authConfigured ? await getWebsiteUser() : null;

  if (user) {
    redirect(nextPath);
  }

  return (
    <div className="center-stage">
      <section className="panel signin-panel">
        <div className="signin-panel__logo">
          <BrandLogo variant="signin" priority />
        </div>

        <div className="page-header__actions signin-panel__actions">
          {authConfigured ? (
            <GitHubSignInButton
              callbackUrl={nextPath}
              className="button button--primary"
            >
              Sign in with GitHub
            </GitHubSignInButton>
          ) : (
            <span className="auth-status">
              {authIssue ?? "Configure GitHub auth to continue"}
            </span>
          )}

          <Link href="/" className="button button--ghost">
            Back Home
          </Link>
        </div>
      </section>
    </div>
  );
}
