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
};

export default nextConfig;
