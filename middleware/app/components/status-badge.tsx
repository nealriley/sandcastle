import type { ReactNode } from "react";

type StatusVariant =
  | "active"
  | "complete"
  | "stopped"
  | "failed"
  | "planned"
  | "draft"
  | "muted";

type PhaseVariant =
  | "thinking"
  | "preview"
  | "complete"
  | "error"
  | "default";

export function StatusBadge({
  children,
  variant = "muted",
  pulse = false,
}: {
  children: ReactNode;
  variant?: StatusVariant;
  pulse?: boolean;
}) {
  return (
    <span className={`status-badge status-badge--${variant}`}>
      {pulse && (
        <span className="status-badge__dot status-badge__dot--pulse" />
      )}
      {children}
    </span>
  );
}

export function PhaseBadge({
  children,
  phase = "default",
}: {
  children: ReactNode;
  phase?: PhaseVariant;
}) {
  return (
    <span className={`status-badge status-badge--phase-${phase}`}>
      {children}
    </span>
  );
}

export function statusToVariant(
  status: string
): StatusVariant {
  switch (status) {
    case "accepted":
    case "running":
    case "active":
      return "active";
    case "complete":
      return "complete";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "planned":
      return "planned";
    case "draft":
      return "draft";
    default:
      return "muted";
  }
}

export function phaseToVariant(
  phase: string
): PhaseVariant {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "preview-starting":
      return "preview";
    case "complete":
      return "complete";
    case "failed":
    case "stalled":
      return "error";
    default:
      return "default";
  }
}
