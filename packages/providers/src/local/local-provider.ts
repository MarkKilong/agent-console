import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EnvSpecSchema,
  type EnvEndpoint,
  type EnvHandle,
  type EnvSpec,
  type EnvStatus,
} from '@agent-console/contracts';
import type { EnvironmentProvider } from '../environment-provider.js';

const READY_TIMEOUT_MS = 20_000;
const STDERR_KEEP = 4_000;

type Environment = {
  handle: EnvHandle;
  spec: EnvSpec;
  token: string;
  port: number;
  child?: ChildProcess;
  /** Set while the runner is booting, so a second create waits instead of spawning. */
  starting?: Promise<void>;
};

/** Runs the runner as a child process on this machine. */
export class LocalProvider implements EnvironmentProvider {
  private readonly environments = new Map<string, Environment>();

  async create(spec: EnvSpec): Promise<EnvHandle> {
    const parsed = EnvSpecSchema.parse(spec);
    if (!parsed.repoPath) {
      throw new Error('The local provider needs repoPath; cloning repoUrl is not supported yet');
    }

    // The provider outlives any one browser session, so reopening a folder must
    // reattach to its runner instead of leaving the old one running unattended.
    const existing = this.findReusable(parsed.repoPath);
    if (existing) {
      await existing.starting;
      return existing.handle;
    }

    const id = randomUUID();
    const environment: Environment = {
      handle: { id, kind: 'local', status: 'creating' },
      spec: parsed,
      token: randomUUID(),
      // Reserved by boot; nothing reads it before create resolves.
      port: 0,
    };
    // Registered before the first await, so a concurrent create for this folder finds it.
    this.environments.set(id, environment);
    environment.starting = this.boot(environment);
    try {
      await environment.starting;
    } finally {
      environment.starting = undefined;
    }
    return environment.handle;
  }

  async start(id: string): Promise<void> {
    const environment = this.get(id);
    if (environment.handle.status === 'gone') {
      throw new Error(`Environment ${id} has been destroyed`);
    }
    if (environment.handle.status === 'running') return;
    await this.spawnRunner(environment);
  }

  async stop(id: string): Promise<void> {
    const environment = this.get(id);
    this.kill(environment);
    environment.handle.status = 'stopped';
  }

  async destroy(id: string): Promise<void> {
    const environment = this.get(id);
    this.kill(environment);
    environment.handle.status = 'gone';
  }

  async endpoint(id: string): Promise<EnvEndpoint> {
    const environment = this.get(id);
    return { url: `ws://127.0.0.1:${environment.port}`, token: environment.token };
  }

  async status(id: string): Promise<EnvStatus> {
    return this.get(id).handle.status;
  }

  /** A folder's runner, running or still booting under a create that has not returned. */
  private findReusable(repoPath: string): Environment | undefined {
    const wanted = comparablePath(repoPath);
    return [...this.environments.values()].find(
      (environment) =>
        (environment.handle.status === 'running' || environment.starting !== undefined) &&
        environment.spec.repoPath !== undefined &&
        comparablePath(environment.spec.repoPath) === wanted,
    );
  }

  private async boot(environment: Environment): Promise<void> {
    environment.port = await freePort();
    await this.spawnRunner(environment);
  }

  private async spawnRunner(environment: Environment): Promise<void> {
    environment.handle.status = 'creating';
    const entry = runnerEntry();

    const child = spawn(process.execPath, entry, {
      cwd: environment.spec.repoPath,
      // stderr is piped so a runner that dies during boot can explain why.
      stdio: ['ignore', 'inherit', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ...environment.spec.env,
        RUNNER_TOKEN: environment.token,
        RUNNER_PORT: String(environment.port),
        RUNNER_CWD: environment.spec.repoPath,
      },
    });
    environment.child = child;

    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
      process.stderr.write(chunk);
    });

    const exited = new Promise<never>((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(exitReason(stderr, code))));
    });

    try {
      // Losing the race to the child means the runner never came up at all.
      await Promise.race([waitForHealth(environment.port), exited]);
    } catch (error) {
      this.kill(environment);
      environment.handle.status = 'stopped';
      throw error;
    }
    environment.handle.status = 'running';
  }

  private kill(environment: Environment): void {
    const child = environment.child;
    environment.child = undefined;
    if (!child?.pid) return;

    if (process.platform === 'win32') {
      // Windows delivers no signal, so the runner cannot shut its agent down itself:
      // kill the whole tree or the agent binary outlives the runner.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    }
    // Elsewhere SIGTERM lets the runner abort its turns before it exits.
    child.kill();
  }

  private get(id: string): Environment {
    const environment = this.environments.get(id);
    if (!environment) throw new Error(`Unknown environment: ${id}`);
    return environment;
  }
}

/** Windows paths name the same folder in any case, so compare them case-insensitively. */
function comparablePath(repoPath: string): string {
  const absolute = resolve(repoPath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** Prefer the compiled runner; fall back to running its TypeScript through tsx. */
function runnerEntry(): string[] {
  const override = process.env.RUNNER_ENTRY?.trim();
  if (override) return [override];

  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve('@agent-console/runner/package.json'));
  const built = join(packageDir, 'dist', 'main.js');
  if (existsSync(built)) return [built];

  // `--import` needs a file:// URL: a bare Windows path is read as a URL scheme.
  const tsx = pathToFileURL(require.resolve('tsx')).href;
  return ['--import', tsx, join(packageDir, 'src', 'main.ts')];
}

/**
 * Node wraps a thrown startup error in a source banner and a version trailer, so the
 * last lines are noise; the `Error:` line carries the reason worth showing.
 */
function exitReason(stderr: string, code: number | null): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const thrown = lines.find((line) => /^[A-Za-z]*Error(?: \[[^\]]+\])?:/.test(line));
  if (thrown) return thrown;
  return lines.slice(-3).join('\n') || `Runner exited with code ${code}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        reject(new Error('Could not reserve a port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // Runner is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Runner on port ${port} did not become healthy in ${READY_TIMEOUT_MS}ms`);
}
