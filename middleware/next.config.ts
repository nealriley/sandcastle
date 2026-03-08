import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the turbopack root to this directory to prevent it from
  // crawling up to parent lockfiles in the monorepo
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server/api/mcp/oauth",
        destination: "/api/mcp/oauth/metadata",
      },
      {
        source: "/.well-known/openid-configuration/api/mcp/oauth",
        destination: "/api/mcp/oauth/metadata",
      },
    ];
  },
};

export default nextConfig;
