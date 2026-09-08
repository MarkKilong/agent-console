import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config.js';
import type { AgentAdapter } from './AgentAdapter.js';
import { ClaudeAgentAdapter } from './ClaudeAgentAdapter.js';
import { FakeAgentAdapter } from './FakeAgentAdapter.js';

export function createAdapter(config: Config): AgentAdapter {
  if (config.agent === 'fake') {
    return new FakeAgentAdapter();
  }
  if (!config.claudeBinary) {
    throw new Error('claudeBinary is required for the claude agent');
  }
  return new ClaudeAgentAdapter({
    pathToClaudeCodeExecutable: config.claudeBinary,
    permissionMode: config.permissionMode as PermissionMode,
  });
}
