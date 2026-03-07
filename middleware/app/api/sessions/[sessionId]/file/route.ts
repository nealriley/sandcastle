/**
 * GET /api/sessions/:sessionId/file?path=src/app/page.tsx — Read a text file.
 *
 * Guardrails:
 * - Only reads files inside /vercel/sandbox
 * - Blocks internal control-plane artifacts
 * - Refuses oversized or binary/non-UTF8 content
 */
import { TextDecoder } from "node:util";
import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { invalidTokenResponse } from "@/lib/auth";
import {
  MAX_TEXT_FILE_BYTES,
  normalizeReadableSandboxPath,
  statusCodeForFileReadError,
} from "@/lib/sandbox-file-access";
import { decodeSessionToken } from "@/lib/tokens";

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isExtendedByte = byte >= 128;

    if (!isWhitespace && !isPrintableAscii && !isExtendedByte) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / sample.length > 0.15;
}

function decodeUtf8(buffer: Buffer): string {
  if (looksBinary(buffer)) {
    throw new Error("ReadFile only supports text files. This file appears to be binary.");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("ReadFile only supports UTF-8 text files.");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId: sessionIdParam } = await params;
  const filePath = req.nextUrl.searchParams.get("path");

  if (!filePath) {
    return Response.json(
      { error: "Missing 'path' query parameter" },
      { status: 400 }
    );
  }

  let sessionData;
  try {
    sessionData = decodeSessionToken(sessionIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid session token");
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeReadableSandboxPath(filePath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid file path";
    return Response.json(
      { error: message },
      { status: statusCodeForFileReadError(message) }
    );
  }

  try {
    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    const buffer = await sandbox.readFileToBuffer({ path: normalizedPath });

    if (!buffer) {
      return Response.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const nodeBuffer = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer);

    if (nodeBuffer.byteLength > MAX_TEXT_FILE_BYTES) {
      return Response.json(
        {
          error: `ReadFile supports files up to ${MAX_TEXT_FILE_BYTES} bytes. This file is ${nodeBuffer.byteLength} bytes.`,
        },
        { status: 413 }
      );
    }

    const content = decodeUtf8(nodeBuffer);

    return Response.json({
      path: normalizedPath,
      sizeBytes: nodeBuffer.byteLength,
      content,
    });
  } catch (error) {
    console.error("Failed to read file:", error);

    const message =
      error instanceof Error ? error.message : "Failed to read file";
    const isNotFound =
      message.includes("not found") ||
      message.includes("ENOENT") ||
      message.includes("No such file");

    return Response.json(
      { error: message },
      { status: isNotFound ? 404 : statusCodeForFileReadError(message) }
    );
  }
}
