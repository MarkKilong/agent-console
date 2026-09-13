import { randomUUID } from 'node:crypto';
import {
  EnvSpecSchema,
  type EnvEndpoint,
  type EnvHandle,
  type EnvSpec,
  type EnvStatus,
} from '@agent-console/contracts';
import type { EnvironmentProvider } from '../environment-provider.js';

/** Where the repository is cloned inside the sandbox; the runner's cwd. */
export const DAYTONA_WORKSPACE = '/workspace/repo';

const RUNNER_PORT = 4310;
const RUNNER_DIR = '/app/packages/runner';
const TOKEN_LABEL = 'agent-console/token';
const CREATE_TIMEOUT_S = 180;
const HEALTH_TIMEOUT_MS = 60_000;
/** Idle minutes before Daytona stops the sandbox, and stopped minutes before it deletes it. */
const AUTO_STOP_MIN = 15;
const AUTO_DELETE_MIN = 24 * 60;

/** The slice of `@daytonaio/sdk` the provider uses, so tests can hand it a fake. */
export interface DaytonaSandbox {
  readonly id: string;
  readonly state?: string;
  readonly labels: Record<string, string>;
  start(timeout?: number): Promise<void>;
  stop(timeout?: number): Promise<void>;
  delete(timeout?: number): Promise<void>;
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
  readonly git: { clone(url: string, path: string, branch?: string): Promise<void> };
  readonly process: {
    createSession(sessionId: string): Promise<void>;
    executeSessionCommand(
      sessionId: string,
      request: { command: string; runAsync?: boolean },
    ): Promise<unknown>;
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
    if (!parsed.repoUrl) {
      throw new Error(
        'The Daytona provider clones repoUrl; a folder on this machine cannot be reached from a sandbox',
      );
    }

    const token = randomUUID();
    const sandbox = await (
      await this.daytona()
    ).create(
      {
        snapshot: this.options.snapshot,
        // The browser opens the WebSocket itself and cannot send Daytona's preview
        // header, so the port is public and the runner token is the only guard.
        public: true,
        envVars: {
          ...parsed.env,
          RUNNER_TOKEN: token,
          RUNNER_PORT: String(RUNNER_PORT),
          RUNNER_CWD: DAYTONA_WORKSPACE,
        },
        labels: { [TOKEN_LABEL]: token, 'agent-console/repo': parsed.repoUrl },
        autoStopInterval: AUTO_STOP_MIN,
        autoDeleteInterval: AUTO_DELETE_MIN,
      },
      { timeout: CREATE_TIMEOUT_S },
    );

    try {
      await sandbox.git.clone(parsed.repoUrl, DAYTONA_WORKSPACE, parsed.branch);
      await launchRunner(sandbox);
    } catch (error) {
      // A half-made sandbox would sit idle and bill until auto-delete.
      await sandbox.delete().catch(() => {});
      throw error;
    }
    return { id: sandbox.id, kind: 'daytona', status: 'running' };
  }

  async start(id: string): Promise<void> {
    const sandbox = await this.sandbox(id);
    if (sandbox.state !== 'started') await sandbox.start();
    // Stopping the sandbox ended the runner process with it.
    await launchRunner(sandbox);
  }

  async stop(id: string): Promise<void> {
    await (await this.sandbox(id)).stop();
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

/** Starts the runner in its own session and waits until it answers on the preview URL. */
async function launchRunner(sandbox: DaytonaSandbox): Promise<void> {
  // A session that survived a previous launch is reused; only a missing one is created.
  await sandbox.process.createSession('runner').catch(() => {});
  await sandbox.process.executeSessionCommand('runner', {
    command: `cd ${RUNNER_DIR} && node dist/main.js`,
    runAsync: true,
  });
  const preview = await sandbox.getPreviewLink(RUNNER_PORT);
  await waitForHealth(preview.url);
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // Runner is still booting, or the proxy has not picked the port up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Runner at ${baseUrl} did not become healthy in ${HEALTH_TIMEOUT_MS}ms`);
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
