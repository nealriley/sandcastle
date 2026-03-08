import { getWebsiteUser } from "@/auth";
import { getOwnedSession } from "./session-ownership";
import { restoreOwnedSandboxSession } from "./owned-sandbox";
import type { SessionOwnershipRecord, SessionToken } from "./types.js";

export interface WebsiteOwnedSandboxContext {
  record: SessionOwnershipRecord;
  session: SessionToken | null;
}

export type WebsiteOwnedSandboxLookup =
  | {
      ok: true;
      context: WebsiteOwnedSandboxContext;
    }
  | {
      ok: false;
      response: Response;
    };

export async function requireWebsiteOwnedSandbox(
  sessionKey: string
): Promise<WebsiteOwnedSandboxLookup> {
  let user;
  try {
    user = await getWebsiteUser();
  } catch (error) {
    console.error("Failed to read website user for sandbox ownership:", error);
    return {
      ok: false,
      response: Response.json(
        { error: "Failed to verify website session." },
        { status: 500 }
      ),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: Response.json(
        { error: "Sign in with GitHub before managing this sandbox." },
        { status: 401 }
      ),
    };
  }

  const record = await getOwnedSession(sessionKey);
  if (!record || record.ownerUserId !== user.id) {
    return {
      ok: false,
      response: Response.json(
        { error: "Sandbox not found." },
        { status: 404 }
      ),
    };
  }

  const session = await restoreOwnedSandboxSession(record);
  return {
    ok: true,
    context: {
      record,
      session,
    },
  };
}
