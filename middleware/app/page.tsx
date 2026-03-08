import Link from "next/link";
import { redirect } from "next/navigation";
import BrandLogo from "./brand-logo";
import {
  getWebsiteAuthConfigurationError,
  getWebsiteUser,
  isWebsiteAuthConfigured,
} from "@/auth";
import { listTemplateCatalog } from "@/lib/template-service";
import { summarizeTemplateRuntimes } from "@/lib/templates";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authConfigured = isWebsiteAuthConfigured();
  const authIssue = authConfigured
    ? null
    : getWebsiteAuthConfigurationError();
  const user = authConfigured ? await getWebsiteUser() : null;

  if (user) {
    redirect("/dashboard");
  }

  let templates: { name: string; summary: string; runtimes: string }[] = [];
  try {
    const catalog = await listTemplateCatalog(null);
    templates = catalog.templates
      .filter(
        (t) =>
          t.templateStatus === "active" && t.latestVersionState === "published"
      )
      .map((t) => ({
        name: t.name,
        summary: t.summary,
        runtimes: summarizeTemplateRuntimes(t),
      }));
  } catch {
    // Template catalog unavailable — render without agent grid
  }

  return (
    <div className="landing">
      <section className="panel" style={{ border: "none", boxShadow: "none", background: "transparent", padding: "var(--space-8) 0" }}>
        <div className="landing-hero__copy" style={{ maxWidth: "38rem" }}>
          <h1 className="hero-title">Run AI agents in the cloud.</h1>
          <p className="page-subtitle">
            Sandcastle gives you a stable place to launch AI coding agents,
            monitor live sessions, and iterate on results — all from your
            browser.
          </p>
          <div className="page-header__actions">
            {authConfigured ? (
              <Link
                href="/signin?callbackUrl=%2Fdashboard"
                className="button button--primary"
              >
                Get started
              </Link>
            ) : (
              <span className="auth-status">
                {authIssue ?? "Configure GitHub auth to continue"}
              </span>
            )}
          </div>
        </div>
      </section>

      {templates.length > 0 && (
        <section>
          <p className="page-kicker" style={{ marginBottom: "var(--space-4)" }}>
            Available agents
          </p>
          <div className="agent-grid">
            {templates.map((t) => (
              <div key={t.name} className="agent-card">
                <div className="agent-card__name">{t.name}</div>
                <div className="agent-card__summary">{t.summary}</div>
                <div className="agent-card__tags">
                  {t.runtimes
                    .split(",")
                    .map((r) => r.trim())
                    .filter(Boolean)
                    .map((tag) => (
                      <span key={tag} className="agent-card__tag">
                        {tag}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="steps-strip">
        <div className="steps-strip__step">
          <div className="steps-strip__number">1</div>
          <div className="steps-strip__label">Choose an agent</div>
          <div className="steps-strip__desc">Pick a template from the marketplace</div>
        </div>
        <div className="steps-strip__step">
          <div className="steps-strip__number">2</div>
          <div className="steps-strip__label">Launch a sandbox</div>
          <div className="steps-strip__desc">Give it a prompt and hit launch</div>
        </div>
        <div className="steps-strip__step">
          <div className="steps-strip__number">3</div>
          <div className="steps-strip__label">Monitor & iterate</div>
          <div className="steps-strip__desc">Watch logs, send follow-ups, preview results</div>
        </div>
      </section>
    </div>
  );
}
