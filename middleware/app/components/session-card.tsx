"use client";

import Link from "next/link";
import { StatusBadge, statusToVariant } from "./status-badge";

function timeAgo(ts: number): string {
  const totalSeconds = Math.floor((Date.now() - ts) / 1000);
  if (totalSeconds < 60) return `${Math.max(totalSeconds, 1)}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m ago` : `${hours}h ago`;
}

function truncate(value: string | null, max = 100): string {
  if (!value) return "No prompt recorded";
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export default function SessionCard({
  sandboxId,
  templateName,
  status,
  latestPrompt,
  updatedAt,
  settingsHref,
  sessionKey,
  onStop,
}: {
  sandboxId: string;
  templateName?: string | null;
  status: "active" | "stopped";
  latestPrompt: string | null;
  updatedAt: number;
  settingsHref: string;
  sessionKey: string;
  onStop?: (sessionKey: string) => void;
}) {
  return (
    <div className="session-card">
      <div className="session-card__header">
        <div className="session-card__title">{sandboxId}</div>
        <StatusBadge
          variant={statusToVariant(status)}
          pulse={status === "active"}
        >
          {status}
        </StatusBadge>
      </div>

      {templateName && (
        <span className="agent-card__tag" style={{ alignSelf: "flex-start" }}>
          {templateName}
        </span>
      )}

      <div className="session-card__prompt">{truncate(latestPrompt)}</div>

      <div className="session-card__footer">
        <span className="session-card__time">{timeAgo(updatedAt)}</span>
        <div className="action-strip">
          {status === "active" && onStop && (
            <button
              type="button"
              className="button button--danger button--tiny"
              onClick={() => onStop(sessionKey)}
            >
              Stop
            </button>
          )}
          <Link href={settingsHref} className="button button--secondary button--tiny">
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}
