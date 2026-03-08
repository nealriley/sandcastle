import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import PageShell from "@/app/components/page-shell";
import Panel from "@/app/components/panel";
import { listOwnedSessions } from "@/lib/session-ownership";
import { listUserEnvironmentVariables } from "@/lib/user-environment";

function formatDate(ts: number | null): string {
  if (!ts) {
    return "Not available yet";
  }

  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(ts: number | null): string {
  if (!ts) {
    return "Not available yet";
  }

  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(label: string | null): string {
  const value = label?.trim();
  if (!value) {
    return "SC";
  }

  return value.slice(0, 2).toUpperCase();
}

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireWebsiteUser("/profile");
  const sessions = await listOwnedSessions(user.id);
  const environmentVariables = await listUserEnvironmentVariables(user.id);

  const activeSessions = sessions.filter((session) => session.status === "active");
  const memberSince =
    sessions.length > 0
      ? Math.min(...sessions.map((session) => session.createdAt))
      : null;
  const latestActivity =
    sessions.length > 0
      ? Math.max(...sessions.map((session) => session.updatedAt))
      : null;
  const displayName = user.name ?? user.login ?? user.email ?? user.id;

  return (
    <PageShell
      kicker="Profile"
      title={displayName}
      subtitle="GitHub identity and Sandcastle account metadata for this workspace."
      actions={
        <>
          <Link href="/dashboard" className="button button--primary button--small">
            Dashboard
          </Link>
          <Link href="/environment" className="button button--ghost button--small">
            Environment
          </Link>
        </>
      }
    >
      <section className="panel">
        <div className="profile-hero">
          <div className="profile-avatar profile-avatar--large">
            {user.image ? (
              <img src={user.image} alt={displayName} className="profile-avatar__image" />
            ) : (
              <span className="profile-avatar__fallback">{initials(displayName)}</span>
            )}
          </div>

          <div className="profile-hero__copy">
            <p className="page-kicker">GitHub account</p>
            <h2 className="panel__title">{displayName}</h2>
            <p className="panel__description">
              {user.login ? `@${user.login}` : "GitHub login unavailable"}
              {user.email ? ` · ${user.email}` : ""}
            </p>
          </div>
        </div>
      </section>

      <section className="stat-grid stat-grid--triple">
        <article className="stat-card">
          <div className="stat-card__label">Total sessions</div>
          <div className="stat-card__value">{sessions.length}</div>
          <div className="stat-card__detail">
            Active: {activeSessions.length} · Stopped: {sessions.length - activeSessions.length}
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-card__label">Saved env vars</div>
          <div className="stat-card__value">{environmentVariables.length}</div>
          <div className="stat-card__detail">
            Reused automatically when marketplace launch fields match.
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-card__label">Latest activity</div>
          <div className="stat-card__value">{formatDate(latestActivity)}</div>
          <div className="stat-card__detail">
            Most recent sandbox update across your account.
          </div>
        </article>
      </section>

      <div className="auth-grid">
        <Panel
          kicker="Identity"
          title="Account details"
          description="Data currently available from the GitHub OAuth session."
        >
          <dl className="meta-list">
            <div className="meta-row">
              <dt>GitHub username</dt>
              <dd>{user.login ? `@${user.login}` : "Not provided"}</dd>
            </div>
            <div className="meta-row">
              <dt>Name</dt>
              <dd>{user.name ?? "Not provided"}</dd>
            </div>
            <div className="meta-row">
              <dt>Email</dt>
              <dd>{user.email ?? "Not provided"}</dd>
            </div>
            <div className="meta-row">
              <dt>User ID</dt>
              <dd className="secret-value">{user.id}</dd>
            </div>
          </dl>
        </Panel>

        <Panel
          kicker="Metadata"
          title="Sandcastle activity"
          description="Derived from your owned sandbox records in Redis."
        >
          <dl className="meta-list">
            <div className="meta-row">
              <dt>Member since</dt>
              <dd>{formatDate(memberSince)}</dd>
            </div>
            <div className="meta-row">
              <dt>Latest activity</dt>
              <dd>{formatDateTime(latestActivity)}</dd>
            </div>
            <div className="meta-row">
              <dt>Stored variables</dt>
              <dd>{environmentVariables.length}</dd>
            </div>
            <div className="meta-row">
              <dt>Account notes</dt>
              <dd>Member since is based on your earliest recorded sandbox.</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </PageShell>
  );
}
