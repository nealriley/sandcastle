import type { Metadata } from "next";
import { requireWebsiteUser } from "@/auth";
import { getOwnedSession } from "@/lib/session-ownership";
import { evaluateSessionViewAccess } from "@/lib/session-view-access";
import { decodeViewToken } from "@/lib/tokens";
import SessionViewer from "@/app/sessions/[viewToken]/session-viewer";

export const metadata: Metadata = {
  title: "Sandbox Console — Sandcastle",
  description: "Live sandbox history, logs, previews, and follow-up controls",
};

export default async function SandboxPage({
  params,
}: {
  params: Promise<{ viewToken: string }>;
}) {
  const { viewToken } = await params;
  const user = await requireWebsiteUser(`/sandboxes/${viewToken}`);

  try {
    const decoded = decodeViewToken(viewToken);
    const record = await getOwnedSession(decoded.sessionKey);
    const access = evaluateSessionViewAccess({
      viewerUserId: user.id,
      tokenOwnerUserId: decoded.ownerUserId,
      recordOwnerUserId: record?.ownerUserId ?? null,
    });

    if (access.kind !== "allowed") {
      return (
        <main className="center-stage">
          <div className="panel center-card">
            <p className="page-kicker">Sandbox access</p>
            <h1 className="page-title">Access denied</h1>
            <p className="page-subtitle">
              This sandbox belongs to a different signed-in user.
            </p>
          </div>
        </main>
      );
    }
  } catch {
    return (
      <main className="center-stage">
        <div className="panel center-card">
          <p className="page-kicker">Sandbox access</p>
          <h1 className="page-title">Sandbox unavailable</h1>
          <p className="page-subtitle">
            This sandbox link is invalid or no longer available.
          </p>
        </div>
      </main>
    );
  }

  return <SessionViewer viewToken={viewToken} />;
}
