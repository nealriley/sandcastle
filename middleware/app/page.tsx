import Link from "next/link";
import { redirect } from "next/navigation";
import BrandLogo from "./brand-logo";
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
    <div className="landing">
      <section className="panel landing-hero">
        <div className="landing-hero__copy">
          <p className="page-kicker">Cloud sandboxes for connected workflows</p>
          <h1 className="hero-title hero-title--landing">
            Run sandboxes in the cloud with Sandcastle.
          </h1>
          <p className="page-subtitle">
            Sandcastle gives teams a stable place to launch, own, inspect, and
            resume cloud sandboxes. Templates, previews, logs, and follow-up
            prompts all stay in one browser-first control plane.
          </p>

          <div className="page-header__actions">
            {authConfigured ? (
              <Link
                href="/signin?callbackUrl=%2Fsandboxes"
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

          <div className="integration-strip">
            <span className="integration-strip__label">
              Connections available today
            </span>
            <span className="tag">SuperHuman Go</span>
            <span className="tag tag--muted">More coming soon</span>
          </div>
        </div>

        <div className="landing-hero__media">
          <BrandLogo variant="hero" priority />
        </div>
      </section>

      <section className="landing-pillars">
        <article className="panel pillar-card">
          <p className="page-kicker">Own the runtime</p>
          <h2 className="panel__title">Every sandbox has a durable home</h2>
          <p className="panel__description">
            Keep ownership, templates, prompts, previews, and session history
            attached to the same sandbox instead of losing state in chat.
          </p>
        </article>

        <article className="panel pillar-card">
          <p className="page-kicker">Operate from the browser</p>
          <h2 className="panel__title">Live console, preview, and control</h2>
          <p className="panel__description">
            Watch long-running tasks, inspect HTML previews, send prompts, and
            stop work without leaving the web UI.
          </p>
        </article>

        <article className="panel pillar-card">
          <p className="page-kicker">Connect automation</p>
          <h2 className="panel__title">SuperHuman Go today, more soon</h2>
          <p className="panel__description">
            Use Connect to pair SHGO into the same owned sandbox workflow today.
            Additional integrations can land without changing the ownership
            model.
          </p>
        </article>
      </section>
    </div>
  );
}
