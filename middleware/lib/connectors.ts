export type ConnectorSlug = "shgo" | "mcp";

export type ConnectorDefinition = {
  slug: ConnectorSlug;
  name: string;
  shortLabel: string;
  summary: string;
  authModel: string;
  status: "ready" | "beta";
  detailPath: `/connect/${ConnectorSlug}`;
  capabilities: string[];
};

const CONNECTORS: ConnectorDefinition[] = [
  {
    slug: "shgo",
    name: "Superhuman Go",
    shortLabel: "SHGO",
    summary:
      "Use a short-lived three-word code to let the Pack list, launch, and resume your Sandcastle sandboxes.",
    authModel: "GitHub sign-in + one-time pairing code",
    status: "ready",
    detailPath: "/connect/shgo",
    capabilities: [
      "List owned sandboxes",
      "Launch from Pack chat",
      "Resume an owned sandbox",
      "Keep website ownership enforcement on the server",
    ],
  },
  {
    slug: "mcp",
    name: "Model Context Protocol",
    shortLabel: "MCP",
    summary:
      "Connect any remote MCP client to Sandcastle with OAuth and Streamable HTTP on Vercel.",
    authModel: "GitHub sign-in + OAuth authorization code flow",
    status: "beta",
    detailPath: "/connect/mcp",
    capabilities: [
      "List launchable templates",
      "Launch, continue, and inspect owned sandboxes",
      "Read previews, files, and task state",
      "Stop owned sandboxes from an MCP client",
    ],
  },
];

export function listConnectors(): ConnectorDefinition[] {
  return [...CONNECTORS];
}

export function getConnector(slug: string): ConnectorDefinition | null {
  return CONNECTORS.find((connector) => connector.slug === slug) ?? null;
}
