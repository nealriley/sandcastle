import { Sandbox } from "@vercel/sandbox";
import { readSessionState } from "./session-state";
import type { SessionOwnershipRecord, SessionToken } from "./types.js";

const DEFAULT_PORTS = [3000, 5173, 8888];

export async function restoreOwnedSandboxSession(
  record: SessionOwnershipRecord
): Promise<SessionToken | null> {
  try {
    const sandbox = await Sandbox.get({ sandboxId: record.sandboxId });
    const state = await readSessionState(sandbox);
    if (!state) {
      return {
        sessionKey: record.sessionKey,
        sandboxId: record.sandboxId,
        agentSessionId: null,
        runtime: record.runtime,
        ports:
          Array.isArray(record.ports) && record.ports.length > 0
            ? record.ports
            : DEFAULT_PORTS,
        createdAt: record.createdAt,
        viewToken: record.latestViewToken,
        ownerUserId: record.ownerUserId,
        ownerLogin: record.ownerLogin,
      };
    }

    return {
      sessionKey: record.sessionKey,
      sandboxId: record.sandboxId,
      agentSessionId: state.agentSessionId,
      runtime: record.runtime ?? state.runtime,
      ports:
        Array.isArray(record.ports) && record.ports.length > 0
          ? record.ports
          : state.ports,
      createdAt: record.createdAt,
      viewToken: record.latestViewToken,
      ownerUserId: record.ownerUserId,
      ownerLogin: record.ownerLogin ?? state.ownerLogin ?? null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("not found") || error.message.includes("ENOENT"))
    ) {
      return null;
    }
    throw error;
  }
}
