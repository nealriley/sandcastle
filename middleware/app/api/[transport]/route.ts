import { z } from "zod";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { continueMcpSandbox, getMcpOwnerFromAuth, getMcpSandboxView, launchMcpSandbox, listMcpSandboxes, listMcpTemplates, readMcpSandboxFile, stopMcpSandbox } from "@/lib/mcp-service";
import { verifyMcpAccessToken } from "@/lib/mcp-auth";
import {
  buildMcpFollowUpPresentation,
  buildMcpLaunchPresentation,
  buildMcpSandboxPresentation,
} from "@/lib/mcp-presentation";

export const dynamic = "force-dynamic";

function jsonToolResult(
  payload: Record<string, unknown>,
  summaryText?: string
) {
  return {
    content: [
      {
        type: "text" as const,
        text: summaryText ?? JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function toolError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "MCP tool call failed.";
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

const environmentEntrySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(20_000),
});

function createAuthenticatedMcpHandler(request: Request) {
  const mcpHandler = createMcpHandler(
    async (server) => {
    server.registerTool(
      "sandcastle_list_templates",
      {
        title: "List Sandcastle templates",
        description: "List the launchable templates available to the authenticated Sandcastle user.",
      },
      async (extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const templates = await listMcpTemplates(owner);
          return jsonToolResult({ templates });
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_list_sandboxes",
      {
        title: "List Sandcastle sandboxes",
        description: "List the authenticated user's owned sandboxes.",
        inputSchema: {
          includeStopped: z.boolean().optional(),
        },
      },
      async ({ includeStopped }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const sandboxes = await listMcpSandboxes(
            request,
            owner,
            includeStopped ?? true
          );
          return jsonToolResult({
            sandboxes: sandboxes.map((sandbox) => ({
              ...sandbox,
              followAlongUrl: sandbox.sandboxUrl,
            })),
            note:
              "Use followAlongUrl or sandboxUrl for the Sandcastle website. sandboxId is an internal identifier, not a browser URL.",
          });
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_launch_sandbox",
      {
        title: "Launch Sandcastle sandbox",
        description: "Launch a new sandbox from a template for the authenticated user.",
        inputSchema: {
          templateSlug: z.string().min(1),
          prompt: z.string().optional(),
          runtime: z.enum(["node24", "node22", "python3.13"]).optional(),
          environment: z.array(environmentEntrySchema).optional(),
        },
      },
      async ({ templateSlug, prompt, runtime, environment }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const task = await launchMcpSandbox(request, owner, {
            templateSlug,
            prompt,
            runtime,
            environment,
          });
          const presentation = buildMcpLaunchPresentation(task);
          return jsonToolResult(presentation.payload, presentation.summary);
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_get_sandbox",
      {
        title: "Get Sandcastle sandbox",
        description: "Read detailed status, previews, tasks, and log state for one owned sandbox.",
        inputSchema: {
          sandboxId: z.string().min(1),
        },
      },
      async ({ sandboxId }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const sandbox = await getMcpSandboxView(request, owner, sandboxId);
          const presentation = buildMcpSandboxPresentation(sandbox);
          return jsonToolResult(presentation.payload, presentation.summary);
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_continue_sandbox",
      {
        title: "Continue Sandcastle sandbox",
        description:
          "Queue a follow-up prompt for an active owned sandbox that supports follow-up work.",
        inputSchema: {
          sandboxId: z.string().min(1),
          prompt: z.string().min(1),
        },
      },
      async ({ sandboxId, prompt }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const task = await continueMcpSandbox(request, owner, {
            sandboxId,
            prompt,
          });
          const presentation = buildMcpFollowUpPresentation(task);
          return jsonToolResult(presentation.payload, presentation.summary);
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_read_sandbox_file",
      {
        title: "Read Sandcastle sandbox file",
        description: "Read a UTF-8 text file from an owned sandbox.",
        inputSchema: {
          sandboxId: z.string().min(1),
          path: z.string().min(1),
        },
      },
      async ({ sandboxId, path }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const file = await readMcpSandboxFile(owner, sandboxId, path);
          return jsonToolResult({ file });
        } catch (error) {
          return toolError(error);
        }
      }
    );

    server.registerTool(
      "sandcastle_stop_sandbox",
      {
        title: "Stop Sandcastle sandbox",
        description: "Stop an owned sandbox immediately.",
        inputSchema: {
          sandboxId: z.string().min(1),
        },
      },
      async ({ sandboxId }, extra) => {
        try {
          const owner = getMcpOwnerFromAuth(extra);
          const result = await stopMcpSandbox(owner, sandboxId);
          return jsonToolResult(result);
        } catch (error) {
          return toolError(error);
        }
      }
    );
    },
    {
      serverInfo: {
        name: "sandcastle",
        version: "1.0.0",
      },
    },
    {
      basePath: "/api",
      disableSse: true,
      maxDuration: 60,
      onEvent(event) {
        if (
          event.type === "REQUEST_RECEIVED" ||
          event.type === "REQUEST_COMPLETED" ||
          event.type === "ERROR"
        ) {
          console.log(
            JSON.stringify({
              namespace: "sandcastle.mcp",
              requestUrl: request.url,
              ...event,
            })
          );
        }
      },
    }
  );

  return withMcpAuth(mcpHandler, verifyMcpAccessToken, {
    required: true,
    requiredScopes: ["mcp"],
    resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
  });
}

async function handleMcpRequest(
  req: Request,
  params: Promise<{ transport: string }>
) {
  const { transport } = await params;
  if (transport !== "mcp") {
    return new Response("Not found", { status: 404 });
  }

  const authenticatedMcpHandler = createAuthenticatedMcpHandler(req);
  return authenticatedMcpHandler(req);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ transport: string }> }
) {
  return handleMcpRequest(req, params);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ transport: string }> }
) {
  return handleMcpRequest(req, params);
}
