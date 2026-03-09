import { getWebsiteUser } from "../auth";
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

interface WebsiteOwnedSandboxDependencies {
  getWebsiteUser: typeof getWebsiteUser;
  getOwnedSession: typeof getOwnedSession;
  restoreOwnedSandboxSession: typeof restoreOwnedSandboxSession;
}

const defaultDependencies: WebsiteOwnedSandboxDependencies = {
  getWebsiteUser,
  getOwnedSession,
  restoreOwnedSandboxSession,
};

function internalErrorResponse(message: string): WebsiteOwnedSandboxLookup {
  return {
    ok: false,
    response: Response.json(
      { error: message },
      { status: 500 }
    ),
  };
}

export async function requireWebsiteOwnedSandbox(
  sessionKey: string
): Promise<WebsiteOwnedSandboxLookup> {
  return requireWebsiteOwnedSandboxWithDependencies(
    sessionKey,
    defaultDependencies
  );
}

export async function requireWebsiteOwnedSandboxWithDependencies(
  sessionKey: string,
  dependencies: WebsiteOwnedSandboxDependencies
): Promise<WebsiteOwnedSandboxLookup> {
  let user;
  try {
    user = await dependencies.getWebsiteUser();
  } catch (error) {
    console.error("Failed to read website user for sandbox ownership:", error);
    return internalErrorResponse("Failed to verify website session.");
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

  let record: SessionOwnershipRecord | null;
  try {
    record = await dependencies.getOwnedSession(sessionKey);
  } catch (error) {
    console.error("Failed to read owned sandbox record:", error);
    return internalErrorResponse("Failed to load sandbox ownership.");
  }

  if (!record || record.ownerUserId !== user.id) {
    return {
      ok: false,
      response: Response.json(
        { error: "Sandbox not found." },
        { status: 404 }
      ),
    };
  }

  let session: SessionToken | null;
  try {
    session = await dependencies.restoreOwnedSandboxSession(record);
  } catch (error) {
    console.error("Failed to restore website-owned sandbox session:", error);
    return internalErrorResponse("Failed to restore sandbox session.");
  }

  return {
    ok: true,
    context: {
      record,
      session,
    },
  };
}
