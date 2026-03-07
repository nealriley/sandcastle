import type { Metadata } from "next";
import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import CopyCodeButton from "../copy-code-button";
import { getOrCreatePairingCode } from "@/lib/pairing";
import { isRateLimitError } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connector — Sandcastle",
  description:
    "Connector codes for pairing SHGO with your owned Sandcastle sandboxes",
};

function formatExpiry(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function ConnectorPage() {
  const user = await requireWebsiteUser("/connector");

  try {
    const pairing = await getOrCreatePairingCode(user);

    return (
      <div className="page-stack">
        <section className="page-header">
          <div className="page-header__copy">
            <p className="page-kicker">Connector</p>
            <h1 className="page-title">Generate a three-word connector code</h1>
            <p className="page-subtitle">
              Signed in as{" "}
              <strong>
                @{user.login ?? user.name ?? user.email ?? user.id}
              </strong>
              . Use this short-lived code only when SHGO asks to authenticate a
              sandbox action.
            </p>
          </div>

          <div className="page-header__actions">
            <Link href="/sandboxes" className="button button--secondary">
              Back to sandboxes
            </Link>
            <Link href="/templates" className="button button--ghost">
              Templates
            </Link>
          </div>
        </section>

        <div className="detail-grid detail-grid--connect">
          <section className="panel">
            <div className="panel__header panel__header--split">
              <div>
                <p className="page-kicker">Current code</p>
                <h2 className="panel__title">Short-lived connector auth</h2>
              </div>
              <CopyCodeButton text={pairing.code} />
            </div>

            <div className="phrase-block">{pairing.code}</div>

            <div className="stat-grid stat-grid--triple">
              <div className="stat-card">
                <div className="stat-card__label">Expires</div>
                <div className="stat-card__value">
                  {formatExpiry(pairing.expiresAt)}
                </div>
                <div className="stat-card__detail">
                  Short-lived and rotated automatically.
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Scope</div>
                <div className="stat-card__value">Current SHGO pairing</div>
                <div className="stat-card__detail">
                  Use it while SHGO lists, resumes, or creates your next
                  sandbox.
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Ownership</div>
                <div className="stat-card__value">@{user.login ?? user.id}</div>
                <div className="stat-card__detail">
                  Any sandbox created from this handoff is locked to your
                  account.
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel--muted">
            <div className="panel__header">
              <div>
                <p className="page-kicker">Use it when prompted</p>
                <h2 className="panel__title">Recommended flow</h2>
              </div>
            </div>

            <ol className="step-list">
              <li>Keep this page open while you work with SHGO.</li>
              <li>
                Paste the code into chat only when SHGO asks to authenticate a
                sandbox action.
              </li>
              <li>
                Return to Sandcastle to watch logs, previews, settings, and
                future prompts.
              </li>
            </ol>
          </section>
        </div>
      </div>
    );
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    return (
      <div className="page-stack">
        <section className="page-header">
          <div className="page-header__copy">
            <p className="page-kicker">Connector</p>
            <h1 className="page-title">Connector refresh is throttled</h1>
            <p className="page-subtitle">{error.message}</p>
          </div>

          <div className="page-header__actions">
            <Link href="/sandboxes" className="button button--secondary">
              Back to sandboxes
            </Link>
          </div>
        </section>

        <div className="alert alert--error">
          Try again in about {error.retryAfterSeconds} seconds. This limit keeps
          connector-code generation abuse-resistant.
        </div>
      </div>
    );
  }
}
