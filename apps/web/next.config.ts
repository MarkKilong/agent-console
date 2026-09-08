import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Contracts ship ES2023 ESM and are imported by client components.
  transpilePackages: ['@agent-console/contracts'],
  // Next writes AGENTS.md/CLAUDE.md into the app on first dev boot; not wanted here.
  agentRules: false,
  // Kept out of any server bundle so their native/child-process behaviour survives.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', 'ws'],
};

export default nextConfig;
