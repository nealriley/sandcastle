export function getErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error ? error.message : fallback;
}

export function isMissingSandboxError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("not found") || error.message.includes("ENOENT")
  );
}

export function isInvalidViewTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Invalid token prefix" ||
    error.message === "Invalid token format" ||
    error.message === "Invalid token signature" ||
    error.message === "Unsupported token version" ||
    error.message === "Token expired"
  );
}
