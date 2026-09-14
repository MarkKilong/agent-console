import { randomUUID } from 'node:crypto';
import {
  EnvSpecSchema,
  type EnvEndpoint,
  type EnvFile,
  type EnvHandle,
  type EnvSpec,
  type EnvStatus,
} from '@agent-console/contracts';
import type { EnvironmentProvider } from '../environment-provider.js';

/** Where the repository is cloned inside the sandbox; the runner's cwd. */
export const DAYTONA_WORKSPACE = '/workspace/repo';

/**
 * The credential layout every sandbox gets, fixed so a file captured from one sandbox
 * can be written back into the next at the same path. Set as env vars at create, after
 * the caller's own, so nothing inherited from the control plane can move them.
 */
export const DAYTONA_HOME = '/root';
export const DAYTONA_CLAUDE_CONFIG_DIR = `${DAYTONA_HOME}/.claude`;
export const DAYTONA_DATA_DIR = `${DAYTONA_HOME}/.agent-console`;

const RUNNER_PORT = 4310;
const RUNNER_DIR = '/app/packages/runner';
const TOKEN_LABEL = 'agent-console/token';
const KIND_LABEL = 'agent-console/kind';
const NAME_LABEL = 'agent-console/name';
const CREATE_TIMEOUT_S = 180;
const HEALTH_TIMEOUT_MS = 60_000;
/** Idle minutes before Daytona stops the sandbox, and stopped minutes before it deletes it. */
const AUTO_STOP_MIN = 15;
const AUTO_DELETE_MIN = 2 * 60;
/** A sign-in lasts seconds, so an abandoned auth sandbox stops soon and is deleted at once. */
const AUTH_AUTO_STOP_MIN = 5;
const AUTH_AUTO_DELETE_MIN = 0;

/** The slice of `@daytonaio/sdk` the provider uses, so tests can hand it a fake. */
export interface DaytonaSandbox {
  readonly id: string;
  readonly state?: string;
  readonly labels: Record<string, string>;
  /** ISO 8601; the sweep needs it to tell an abandoned auth sandbox from a fresh one. */
  readonly createdAt?: string;
  start(timeout?: number): Promise<void>;
  stop(timeout?: number): Promise<void>;
  delete(timeout?: number): Promise<void>;
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
  readonly git: { clone(url: string, path: string, branch?: string): Promise<void> };
  readonly fs: {
    createFolder(path: string, mode: string): Promise<void>;
    uploadFiles(files: Array<{ source: Buffer; destination: string }>): Promise<void>;
    downloadFile(remotePath: string): Promise<Buffer>;
    setFilePermissions(path: string, permissions: { mode?: string }): Promise<void>;
  };
  readonly process: {
    createSession(sessionId: string): Promise<void>;
    executeSessionCommand(
      sessionId: string,
      request: { command: string; runAsync?: boolean },
    ): Promise<unknown>;
    executeCommand(command: string, cwd?: string): Promise<{ exitCode: number; result?: string }>;
  };
}

export interface DaytonaClient {
  create(
    params: {
      snapshot: string;
      public: boolean;
      envVars: Record<string, string>;
      labels: Record<string, string>;
      autoStopInterval: number;
      autoDeleteInterval: number;
    },
    options: { timeout: number },
  ): Promise<DaytonaSandbox>;
  get(sandboxId: string): Promise<DaytonaSandbox>;
  list(query?: { labels?: Record<string, string> }): AsyncIterable<DaytonaSandbox>;
}

export type DaytonaProviderOptions = {
  /** Name of the runner snapshot, e.g. `agent-console-runner:0.1.2`. */
  snapshot: string;
  /** Defaults to the SDK's own lookup of DAYTONA_API_KEY / DAYTONA_API_URL. */
  client?: DaytonaClient;
};

/**
 * Runs the runner inside a Daytona sandbox created from a prebuilt snapshot.
 *
 * Holds no state of its own: the sandbox id is the environment id and the runner token
 * travels as a sandbox label, so any instance of the control plane — including a fresh
 * serverless invocation — can answer for an environment another one created.
 */
export class DaytonaProvider implements EnvironmentProvider {
  private client?: Promise<DaytonaClient>;

  constructor(private readonly options: DaytonaProviderOptions) {}

  async create(spec: EnvSpec): Promise<EnvHandle> {
    const parsed = EnvSpecSchema.parse(spec);
    if (parsed.repoPath) {
      throw new Error(
        'The Daytona provider clones repoUrl; a folder on this machine cannot be reached from a sandbox',
      );
    }
    // The auth sandbox only drives a sign-in, so it holds no project and lives minutes.
    const auth = parsed.kind === 'auth';
    const repoUrl = parsed.repoUrl;

    const token = randomUUID();
    const client = await this.daytona();
    const params = {
      snapshot: this.options.snapshot,
      // The browser opens the WebSocket itself and cannot send Daytona's preview
      // header, so the port is public and the runner token is the only guard.
      public: true,
      envVars: {
        ...parsed.env,
        HOME: DAYTONA_HOME,
        CLAUDE_CONFIG_DIR: DAYTONA_CLAUDE_CONFIG_DIR,
        AGENT_CONSOLE_DATA_DIR: DAYTONA_DATA_DIR,
        RUNNER_TOKEN: token,
        RUNNER_PORT: String(RUNNER_PORT),
        RUNNER_CWD: DAYTONA_WORKSPACE,
      },
      labels: {
        [TOKEN_LABEL]: token,
        ...(auth ? { [KIND_LABEL]: 'auth' } : {}),
        ...(repoUrl ? { 'agent-console/repo': repoUrl } : {}),
        ...(parsed.name ? { [NAME_LABEL]: parsed.name } : {}),
      },
      autoStopInterval: auth ? AUTH_AUTO_STOP_MIN : AUTO_STOP_MIN,
      autoDeleteInterval: auth ? AUTH_AUTO_DELETE_MIN : AUTO_DELETE_MIN,
    };

    let sandbox: DaytonaSandbox;
    try {
      sandbox = await client.create(params, { timeout: CREATE_TIMEOUT_S });
    } catch (error) {
      // A stopped sandbox still holds its disk, so the cap is reached with nothing running;
      // the memory cap is left alone, since freeing it would stop a sandbox someone is using.
      const capped = error instanceof Error && error.message.includes('Total disk limit exceeded');
      if (!capped || !(await evictOldestStopped(client))) throw error;
      sandbox = await client.create(params, { timeout: CREATE_TIMEOUT_S });
    }

    try {
      if (repoUrl) await sandbox.git.clone(repoUrl, DAYTONA_WORKSPACE, parsed.branch);
      else await sandbox.fs.createFolder(DAYTONA_WORKSPACE, '755');
      // A project with no repository is still a repository: diffs and commits need one.
      if (!auth && !repoUrl) await gitInit(sandbox);
      // Before the runner: the CLIs read their credentials as they start.
      await writeFiles(sandbox, parsed.files);
      await launchRunner(sandbox);
    } catch (error) {
      // A half-made sandbox would sit idle and bill until auto-delete.
      await sandbox.delete().catch(() => {});
      throw error;
    }
    return { id: sandbox.id, kind: 'daytona', status: 'running' };
  }

  /**
   * Writes credential files into a sandbox that already exists — a sign-in that landed after
   * create, or a resume. The CLIs read these files per turn, so no runner restart is needed.
   */
  async writeFiles(id: string, files: EnvFile[]): Promise<void> {
    await writeFiles(await this.sandbox(id), files);
  }

  /**
   * Reads credential files back out of a sandbox. Not on `EnvironmentProvider`: only a
   * provider that injects files has any to read. Paths that do not exist are left out,
   * so a sign-in that wrote one file does not clear the others.
   */
  async readFiles(id: string, paths: readonly string[]): Promise<Record<string, string>> {
    const sandbox = await this.sandbox(id);
    const found = await Promise.all(
      paths.map(async (path) => {
        try {
          return [path, (await sandbox.fs.downloadFile(path)).toString('utf8')] as const;
        } catch {
          return undefined;
        }
      }),
    );
    return Object.fromEntries(found.filter((entry) => entry !== undefined));
  }

  /**
   * Deletes auth sandboxes older than `maxAgeMs`: the backstop for the ones a browser never
   * closed, which otherwise hold the organisation's whole memory quota until someone notices.
   * Project sandboxes carry no `kind` label, so the query cannot reach them.
   */
  async sweepStaleAuth(maxAgeMs: number): Promise<string[]> {
    const cutoff = Date.now() - maxAgeMs;
    const swept: string[] = [];
    for await (const sandbox of (await this.daytona()).list({ labels: { [KIND_LABEL]: 'auth' } })) {
      const created = Date.parse(sandbox.createdAt ?? '');
      // An unreadable age counts as fresh: deleting a sign-in in progress is the worse mistake.
      if (!Number.isFinite(created) || created > cutoff) continue;
      const deleted = await sandbox.delete().then(
        () => true,
        () => false,
      );
      if (deleted) swept.push(sandbox.id);
    }
    return swept;
  }

  async start(id: string): Promise<void> {
    const sandbox = await this.sandbox(id);
    if (sandbox.state !== 'started') await sandbox.start();
    // Stopping the sandbox ended the runner with it; an idle one still has the old process.
    const { url } = await sandbox.getPreviewLink(RUNNER_PORT);
    if (!(await isHealthy(url))) await launchRunner(sandbox);
  }

  async stop(id: string): Promise<void> {
    const sandbox = await this.sandbox(id);
    if (sandbox.state === 'started') await sandbox.stop();
  }

  async destroy(id: string): Promise<void> {
    let sandbox: DaytonaSandbox;
    try {
      sandbox = await this.sandbox(id);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    await sandbox.delete();
  }

  async endpoint(id: string): Promise<EnvEndpoint> {
    const sandbox = await this.sandbox(id);
    const token = sandbox.labels[TOKEN_LABEL];
    if (!token) throw new Error(`Sandbox ${id} was not created by agent-console`);
    const preview = await sandbox.getPreviewLink(RUNNER_PORT);
    return { url: preview.url.replace(/^http/, 'ws'), token };
  }

  async status(id: string): Promise<EnvStatus> {
    let sandbox: DaytonaSandbox;
    try {
      sandbox = await this.sandbox(id);
    } catch (error) {
      if (isNotFound(error)) return 'gone';
      throw error;
    }
    return statusOf(sandbox.state);
  }

  private async sandbox(id: string): Promise<DaytonaSandbox> {
    return (await this.daytona()).get(id);
  }

  /** The SDK is heavy to load, so it is imported on first use and only when chosen. */
  private daytona(): Promise<DaytonaClient> {
    this.client ??= this.options.client
      ? Promise.resolve(this.options.client)
      : import('@daytonaio/sdk').then((sdk) => new sdk.Daytona() as unknown as DaytonaClient);
    return this.client;
  }
}

/**
 * Deletes the oldest stopped project sandbox this app made, which frees the one disk slot a
 * create needs; false when there is none to take, so the caller can rethrow the cap error.
 * Running ones belong to whoever is using them and auth ones to the sweep.
 */
async function evictOldestStopped(client: DaytonaClient): Promise<boolean> {
  let oldest: { sandbox: DaytonaSandbox; created: number } | undefined;
  for await (const sandbox of client.list()) {
    if (!sandbox.labels[TOKEN_LABEL] || sandbox.labels[KIND_LABEL]) continue;
    if (statusOf(sandbox.state) !== 'stopped') continue;
    const created = Date.parse(sandbox.createdAt ?? '');
    // An unreadable age cannot be compared, and a sandbox is not worth deleting on a guess.
    if (!Number.isFinite(created)) continue;
    if (!oldest || created < oldest.created) oldest = { sandbox, created };
  }
  if (!oldest) return false;
  await oldest.sandbox.delete();
  return true;
}

/** Writes the spec's files; the upload API creates missing parent directories itself. */
async function writeFiles(sandbox: DaytonaSandbox, files: EnvFile[] | undefined): Promise<void> {
  if (!files?.length) return;
  await sandbox.fs.uploadFiles(
    files.map((file) => ({ source: Buffer.from(file.content, 'utf8'), destination: file.path })),
  );
  // Uploads land at 0644; a credential that asked for narrower is tightened afterwards.
  for (const file of files) {
    if (file.mode === undefined) continue;
    await sandbox.fs.setFilePermissions(file.path, { mode: file.mode.toString(8) });
  }
}

/** Makes the empty workspace a git repository, which is what the runner diffs against. */
async function gitInit(sandbox: DaytonaSandbox): Promise<void> {
  const { exitCode, result } = await sandbox.process.executeCommand('git init', DAYTONA_WORKSPACE);
  if (exitCode !== 0) throw new Error(`git init failed in the sandbox: ${result ?? exitCode}`);
}

/** Starts the runner in its own session and waits until it answers on the preview URL. */
async function launchRunner(sandbox: DaytonaSandbox): Promise<void> {
  // A session that survived a previous launch is reused; only a missing one is created.
  await sandbox.process.createSession('runner').catch(() => {});
  await sandbox.process.executeSessionCommand('runner', {
    // The sandbox runs as root, and Claude Code refuses to skip permissions as root unless
    // told it is inside a sandbox. On the launch command so a woken sandbox gets it too.
    command: `cd ${RUNNER_DIR} && IS_SANDBOX=1 node dist/main.js`,
    runAsync: true,
  });
  const preview = await sandbox.getPreviewLink(RUNNER_PORT);
  await waitForHealth(preview.url);
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Runner at ${baseUrl} did not become healthy in ${HEALTH_TIMEOUT_MS}ms`);
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    // Runner is still booting, gone with a stop, or the proxy has not picked the port up yet.
    return false;
  }
}

function statusOf(state: string | undefined): EnvStatus {
  switch (state) {
    case 'started':
      return 'running';
    case 'stopped':
    case 'archived':
    case 'paused':
      return 'stopped';
    case 'destroyed':
    case 'destroying':
    case 'error':
    case 'build_failed':
      return 'gone';
    default:
      return 'creating';
  }
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'DaytonaNotFoundError' || /not found/i.test(error.message);
}
