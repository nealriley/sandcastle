export type SessionViewAccessResult =
  | {
      kind: "unauthenticated";
      ownerUserId: string;
    }
  | {
      kind: "forbidden";
      ownerUserId: string;
    }
  | {
      kind: "allowed";
      ownerUserId: string;
    };

export function evaluateSessionViewAccess(args: {
  viewerUserId: string | null;
  tokenOwnerUserId: string;
  recordOwnerUserId?: string | null;
}): SessionViewAccessResult {
  const ownerUserId = args.recordOwnerUserId ?? args.tokenOwnerUserId;

  if (!args.viewerUserId) {
    return {
      kind: "unauthenticated",
      ownerUserId,
    };
  }

  if (args.viewerUserId !== ownerUserId) {
    return {
      kind: "forbidden",
      ownerUserId,
    };
  }

  return {
    kind: "allowed",
    ownerUserId,
  };
}
