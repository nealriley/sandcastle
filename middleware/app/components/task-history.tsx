import {
  StatusBadge,
  statusToVariant,
} from "./status-badge";

type TaskStatus = "accepted" | "running" | "complete" | "failed" | "stopped";
type TaskPhase =
  | "queued" | "booting" | "prompting" | "thinking" | "coding"
  | "installing" | "preview-starting" | "waiting-for-input"
  | "stalled" | "complete" | "failed" | "stopped";

export interface TaskHistoryItem {
  taskId: string;
  prompt: string;
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  updatedAt: number;
  result: string | null;
  error: string | null;
}

const phaseLabels: Record<TaskPhase, string> = {
  queued: "Queued",
  booting: "Booting",
  prompting: "Starting",
  thinking: "Thinking",
  coding: "Coding",
  installing: "Installing",
  "preview-starting": "Preview",
  "waiting-for-input": "Waiting",
  stalled: "Stalled",
  complete: "Complete",
  failed: "Failed",
  stopped: "Stopped",
};

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "accepted": return "Accepted";
    case "running": return "Running";
    case "complete": return "Complete";
    case "failed": return "Failed";
    default: return "Stopped";
  }
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(value: string | null, max = 120): string {
  if (!value) return "\u2014";
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export default function TaskHistory({ tasks }: { tasks: TaskHistoryItem[] }) {
  if (tasks.length === 0) {
    return <div className="empty-state">Waiting for the first recorded task.</div>;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {tasks
            .slice()
            .reverse()
            .map((task) => (
              <tr key={task.taskId}>
                <td className="data-table__primary">
                  <div className="table-primary">{truncate(task.prompt, 120)}</div>
                  <div className="table-note">{phaseLabels[task.phase]}</div>
                </td>
                <td>
                  <StatusBadge variant={statusToVariant(task.status)}>
                    {statusLabel(task.status)}
                  </StatusBadge>
                </td>
                <td>{formatDateTime(task.updatedAt)}</td>
                <td className="data-table__summary">
                  {truncate(task.error ?? task.result ?? task.phaseDetail ?? "\u2014", 160)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
