import path from "node:path";

const SANDBOX_ROOT = "/vercel/sandbox";

export const MAX_TEXT_FILE_BYTES = 256 * 1024;

const INTERNAL_FILE_PATTERNS = [
  /^\.task-/,
  /^\.log-/,
  /^\.result-/,
  /^\.sandcastle-env\.json$/,
  /^\.shgo-session\.json$/,
];

export function normalizeReadableSandboxPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("File path cannot be empty.");
  }

  if (trimmed.includes("\0")) {
    throw new Error("File path contains invalid characters.");
  }

  const normalized = trimmed.startsWith("/")
    ? path.posix.normalize(trimmed)
    : path.posix.normalize(path.posix.join(SANDBOX_ROOT, trimmed));

  if (normalized === SANDBOX_ROOT) {
    throw new Error("Path must point to a file inside /vercel/sandbox.");
  }

  if (
    normalized !== SANDBOX_ROOT &&
    !normalized.startsWith(`${SANDBOX_ROOT}/`)
  ) {
    throw new Error("Path must stay inside /vercel/sandbox.");
  }

  const relativePath = path.posix.relative(SANDBOX_ROOT, normalized);
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    relativePath === ".."
  ) {
    throw new Error("Path must stay inside /vercel/sandbox.");
  }

  const basename = path.posix.basename(normalized);
  if (INTERNAL_FILE_PATTERNS.some((pattern) => pattern.test(basename))) {
    throw new Error(
      "That file is reserved for internal session state and cannot be read via ReadFile."
    );
  }

  return normalized;
}

export function statusCodeForFileReadError(message: string): number {
  if (
    message.includes("cannot be read via ReadFile") ||
    message.includes("must stay inside /vercel/sandbox") ||
    message.includes("must point to a file inside /vercel/sandbox")
  ) {
    return 403;
  }

  if (
    message.includes("cannot be empty") ||
    message.includes("invalid characters")
  ) {
    return 400;
  }

  if (message.includes("supports text files")) {
    return 415;
  }

  if (message.includes("too large")) {
    return 413;
  }

  return 500;
}
