import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config.js';
import type { AgentAdapter } from './AgentAdapter.js';
import { ClaudeAgentAdapter } from './ClaudeAgentAdapter.js';
import { CodexAgentAdapter } from './codex/CodexAgentAdapter.js';
import { FakeAgentAdapter } from './FakeAgentAdapter.js';

export function createAdapter(config: Config): AgentAdapter {
  if (config.agent === 'fake') {
    return new FakeAgentAdapter();
  }
  if (config.agent === 'codex') {
    if (!config.codexBinary) {
      throw new Error('codexBinary is required for the codex agent');
    }
    return new CodexAgentAdapter({
      command: config.codexBinary,
      args: ['app-server'],
      model: config.codexModel,
    });
  }
  if (!config.claudeBinary) {
    throw new Error('claudeBinary is required for the claude agent');
  }
  return new ClaudeAgentAdapter({
    pathToClaudeCodeExecutable: config.claudeBinary,
    permissionMode: config.permissionMode as PermissionMode,
  });
}
