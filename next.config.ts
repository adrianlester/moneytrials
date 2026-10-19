import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // The schema and the deck are read from disk at runtime. Without this the serverless
  // bundle leaves them out and the first request on Vercel fails.
  outputFileTracingIncludes: {
    "/*": ["./src/lib/schema.sql", "./src/content/deck.json"],
  },
};

export default nextConfig;
