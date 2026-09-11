import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config.js';
import type { AgentAdapter } from './agent-adapter.js';
import { ClaudeAgentAdapter } from './claude-agent-adapter.js';
import { CodexAgentAdapter } from './codex/codex-agent-adapter.js';
import { FakeAgentAdapter } from './fake-agent-adapter.js';

export function createAdapter(
  config: Config,
  apiKey?: () => string | undefined,
  githubToken?: () => string | undefined,
): AgentAdapter {
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
    cwd: config.cwd,
    permissionMode: config.permissionMode as PermissionMode,
    apiKey,
    githubToken,
  });
}
