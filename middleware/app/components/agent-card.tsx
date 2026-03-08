import type { ReactNode } from "react";

export default function AgentCard({
  name,
  summary,
  runtimes,
  status,
  launchLabel = "Launch",
  action,
}: {
  name: string;
  summary: string;
  runtimes: string;
  status?: "live" | "draft" | "unavailable";
  launchLabel?: string;
  action?: ReactNode;
}) {
  const runtimeTags = runtimes
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  return (
    <div className="agent-card">
      <div className="agent-card__header">
        <div className="agent-card__name">{name}</div>
        {status && status !== "live" && (
          <span className={`status-badge status-badge--${status === "draft" ? "planned" : "muted"}`}>
            {status === "draft" ? "Draft" : "Unavailable"}
          </span>
        )}
      </div>
      <div className="agent-card__summary">{summary}</div>
      <div className="agent-card__tags">
        {runtimeTags.map((tag) => (
          <span key={tag} className="agent-card__tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="agent-card__footer">
        <div />
        {action ?? (
          <span className="button button--primary button--small">
            {launchLabel}
          </span>
        )}
      </div>
    </div>
  );
}
