import type { Metadata } from "next";
import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import { getOrCreatePairingCode } from "@/lib/pairing";
import { isRateLimitError } from "@/lib/rate-limit";
import PageShell from "@/app/components/page-shell";
import ConnectCode from "@/app/components/connect-code";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect — Sandcastle",
  description: "Connect SuperHuman Go to your Sandcastle account",
};

export default async function ConnectPage() {
  const user = await requireWebsiteUser("/connect");

  try {
    const pairing = await getOrCreatePairingCode(user);

    return (
      <PageShell
        kicker="Connect"
        title="Connect to SuperHuman Go"
        actions={
          <Link href="/dashboard" className="button button--ghost button--small">
            Back to dashboard
          </Link>
        }
      >
        <div className="panel">
          <ConnectCode code={pairing.code} expiresAt={pairing.expiresAt} />

          <div className="connect-instructions">
            <p>1. Keep this page open while you work with SHGO.</p>
            <p>2. Paste the code when SHGO asks to authenticate a sandbox action.</p>
            <p>3. Return here to manage your sandbox.</p>
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
        kicker="Connect"
        title="Connect refresh is throttled"
        subtitle={error.message}
        actions={
          <Link href="/dashboard" className="button button--secondary button--small">
            Back to dashboard
          </Link>
        }
      >
        <div className="alert alert--error">
          Try again in about {error.retryAfterSeconds} seconds. This limit keeps
          connect-code generation abuse-resistant.
        </div>
      </PageShell>
    );
  }
}
