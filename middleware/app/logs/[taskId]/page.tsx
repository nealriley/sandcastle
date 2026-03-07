import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { decodeTaskToken } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Sandbox Console Redirect — Sandcastle",
  description: "Redirecting legacy task log links to the Sandcastle sandbox console",
};

export default async function LogsPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  try {
    const task = decodeTaskToken(taskId);
    redirect(`/sandboxes/${encodeURIComponent(task.session.viewToken)}`);
  } catch {
    return (
      <div style={{ padding: "2rem", color: "#f0f0f0" }}>
        Invalid legacy logs link.
      </div>
    );
  }
}
