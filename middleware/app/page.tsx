import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getWebsiteAuthConfigurationError,
  getWebsiteUser,
  isWebsiteAuthConfigured,
} from "@/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authConfigured = isWebsiteAuthConfigured();
  const authIssue = authConfigured
    ? null
    : getWebsiteAuthConfigurationError();
  const user = authConfigured ? await getWebsiteUser() : null;

  if (user) {
    redirect("/sandboxes");
  }

  return (
    <div className="page-stack">
      <section className="auth-hero">
        <div className="panel auth-hero__copy">
          <p className="page-kicker">Sandcastle</p>
          <h1 className="hero-title">
            Own, inspect, and resume every coding sandbox from one place.
          </h1>
          <p className="page-subtitle">
            Sandcastle is the stable control plane for sandboxes, templates,
            Connector handoffs, previews, and live execution output. SHGO can
            start or resume work without being the only place that state lives.
          </p>

          <div className="page-header__actions">
            {authConfigured ? (
              <Link
                href="/api/auth/signin/github?callbackUrl=%2Fsandboxes"
                className="button button--primary"
              >
                Sign in with GitHub
              </Link>
            ) : (
              <span className="auth-status">
                {authIssue ?? "Configure GitHub auth to continue"}
              </span>
            )}
          </div>
        </div>

        <section className="panel panel--muted">
          <div className="panel__header">
            <div>
              <p className="page-kicker">Control plane</p>
              <h2 className="panel__title">How Sandcastle works</h2>
            </div>
          </div>

          <ol className="step-list">
            <li>
              <strong>Sign in.</strong> Your GitHub identity becomes the owner
              for every sandbox created from the web or paired through SHGO.
            </li>
            <li>
              <strong>Create or connect.</strong> Start a sandbox from
              Sandcastle, or use Connector when SHGO needs a short-lived
              three-word code.
            </li>
            <li>
              <strong>Operate from the browser.</strong> Keep console output,
              preview links, templates, and follow-up prompts in the web UI
              while SHGO remains a client of the same sandbox.
            </li>
          </ol>
        </section>
      </section>

      <section className="auth-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="page-kicker">Why this exists</p>
              <h2 className="panel__title">Chat is no longer the bottleneck</h2>
            </div>
          </div>
          <ul className="bullet-list">
            <li>Long-running sandbox tasks survive beyond a single request.</li>
            <li>Logs and previews stay visible in a stable browser session.</li>
            <li>Every sandbox remains resumable through ownership and Connector.</li>
          </ul>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <p className="page-kicker">Product surface</p>
              <h2 className="panel__title">What Sandcastle optimizes for</h2>
            </div>
          </div>
          <ul className="bullet-list">
            <li>Minimal tables and clear actions over decorative dashboards.</li>
            <li>Console-first sandbox detail pages instead of card overload.</li>
            <li>Explicit templates, connector flows, and ownership boundaries.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
