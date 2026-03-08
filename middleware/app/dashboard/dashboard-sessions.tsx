"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SessionCard from "@/app/components/session-card";
import EmptyState from "@/app/components/empty-state";
import { readError } from "@/lib/fetch-utils";
import Link from "next/link";

export type DashboardRow = {
  sessionKey: string;
  sandboxId: string;
  runtime: string;
  status: "active" | "stopped";
  latestPrompt: string | null;
  updatedAt: number;
  settingsHref: string;
};

export default function DashboardSessions({ rows }: { rows: DashboardRow[] }) {
  const router = useRouter();
  const [showStopped, setShowStopped] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeRows = rows.filter((r) => r.status === "active");
  const stoppedRows = rows.filter((r) => r.status === "stopped");

  async function handleStop(sessionKey: string) {
    const row = rows.find((r) => r.sessionKey === sessionKey);
    if (!row) return;

    const confirmed = window.confirm(
      `Stop sandbox ${row.sandboxId}? This stops the sandbox immediately.`
    );
    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(sessionKey)}/stop`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      startTransition(() => router.refresh());
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to stop sandbox."
      );
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState>
        No sessions yet. <Link href="/marketplace">Launch your first agent</Link> or{" "}
        <Link href="/connect">connect via SuperHuman Go</Link>.
      </EmptyState>
    );
  }

  return (
    <>
      {activeRows.length > 0 && (
        <div className="session-grid">
          {activeRows.map((row) => (
            <SessionCard
              key={row.sessionKey}
              sandboxId={row.sandboxId}
              templateName={row.runtime}
              status={row.status}
              latestPrompt={row.latestPrompt}
              updatedAt={row.updatedAt}
              settingsHref={row.settingsHref}
              sessionKey={row.sessionKey}
              onStop={handleStop}
            />
          ))}
        </div>
      )}

      {activeRows.length === 0 && (
        <EmptyState>No active sessions right now.</EmptyState>
      )}

      {stoppedRows.length > 0 && (
        <div className="collapsed-section">
          <button
            type="button"
            className="collapsed-section__toggle"
            onClick={() => setShowStopped((v) => !v)}
            disabled={isPending}
          >
            {showStopped ? "Hide" : "Show"} {stoppedRows.length} stopped session
            {stoppedRows.length !== 1 ? "s" : ""}
          </button>

          {showStopped && (
            <div className="session-grid" style={{ marginTop: "var(--space-4)" }}>
              {stoppedRows.map((row) => (
                <SessionCard
                  key={row.sessionKey}
                  sandboxId={row.sandboxId}
                  templateName={row.runtime}
                  status={row.status}
                  latestPrompt={row.latestPrompt}
                  updatedAt={row.updatedAt}
                  settingsHref={row.settingsHref}
                  sessionKey={row.sessionKey}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
