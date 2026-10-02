import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers and SDKs run only in Node route handlers; keep them out of the bundle.
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
