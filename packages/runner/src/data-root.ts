import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The folder every runner on this machine shares: workspace data hashes under it and
 * the Claude API key sits in it, so one login covers every project.
 */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_CONSOLE_DATA_DIR?.trim() || join(homedir(), '.agent-console');
}
