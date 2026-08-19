import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: projectRoot,
  },
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@google/genai",
  ],
};

export default nextConfig;
