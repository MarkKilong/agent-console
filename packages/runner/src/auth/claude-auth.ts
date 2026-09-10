import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthStatusData } from '@agent-console/contracts';

/** Narrow slice of `child_process.spawn`, so tests can point it at a fixture. */
export type SpawnCli = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type ClaudeAuthOptions = {
  binary: string;
  /** `CLAUDE_CONFIG_DIR` for the CLI; unset means the machine default. */
  configDir?: string | undefined;
  /** Where the stored API key lives. */
  dataDir: string;
  env: NodeJS.ProcessEnv;
  spawn?: SpawnCli;
};

type PendingLogin = { child: ChildProcess; output: string };

const URL_TIMEOUT_MS = 30_000;

/**
 * Drives `claude auth …` inside the environment. The login is interactive — the CLI
 * prints an authorization URL and then blocks on stdin — so the child outlives the
 * command that started it and waits for the code the user pastes into the UI.
 */
export class ClaudeAuth {
  private readonly spawn: SpawnCli;
  private pending: PendingLogin | undefined;
  /** The CLI's version never changes under a running runner, so ask for it once. */
  private version: Promise<string | undefined> | undefined;

  constructor(private readonly options: ClaudeAuthOptions) {
    this.spawn =
      options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
  }

  async status(): Promise<AuthStatusData> {
    const extra = {
      apiKey: this.apiKey() !== undefined,
      loginPending: this.pending !== undefined,
      version: await this.cliVersion(),
    };
    const result = await this.run(['auth', 'status', '--json']);
    const parsed = result.code === 0 ? parseStatus(result.stdout) : undefined;
    if (!parsed) return { loggedIn: false, authMethod: 'none', ...extra };
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: text(parsed.authMethod) ?? 'none',
      email: text(parsed.email),
      orgName: text(parsed.orgName),
      subscriptionType: text(parsed.subscriptionType),
      ...extra,
    };
  }

  /** Starts a login and resolves once the CLI has printed the URL to approve. */
  loginStart(): Promise<string> {
    this.killPending();
    const child = this.spawnCli(['auth', 'login']);
    const login: PendingLogin = { child, output: '' };
    this.pending = login;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error('No authorization URL from claude auth login')),
        URL_TIMEOUT_MS,
      );

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pending === login) this.killPending();
        reject(error);
      };

      // Stays attached after the URL arrives: loginCode reports what the CLI said last.
      const onData = (chunk: string) => {
        login.output += chunk;
        if (settled) return;
        const url = findAuthUrl(login.output);
        if (!url) return;
        settled = true;
        clearTimeout(timer);
        resolve(url);
      };

      for (const stream of [child.stdout, child.stderr]) {
        stream?.setEncoding('utf8');
        stream?.on('data', onData);
      }
      child.once('error', fail);
      // `close` rather than `exit`: the CLI's last words can arrive after it is gone.
      child.once('close', () => fail(new Error(failure('Login failed', login.output))));
    });
  }

  /** Answers the pending login's prompt with the code the user pasted. */
  loginCode(code: string): Promise<void> {
    const login = this.pending;
    if (!login) return Promise.reject(new Error('No login in progress'));
    this.pending = undefined;

    return new Promise<void>((resolve, reject) => {
      // Only what the CLI says from here on explains a rejected code.
      const mark = login.output.length;
      login.child.once('error', reject);
      login.child.once('close', (exitCode) => {
        if (exitCode === 0) resolve();
        else reject(new Error(failure('Login failed', login.output.slice(mark))));
      });
      login.child.stdin?.write(`${code}\n`);
    });
  }

  async logout(): Promise<void> {
    this.killPending();
    const result = await this.run(['auth', 'logout']);
    if (result.code !== 0) {
      throw new Error(failure('Logout failed', `${result.stdout}\n${result.stderr}`));
    }
  }

  setApiKey(key: string): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const path = this.credentialsPath();
    rmSync(path, { force: true });
    writeFileSync(path, JSON.stringify({ anthropicApiKey: key }), { mode: 0o600 });
  }

  clearApiKey(): void {
    rmSync(this.credentialsPath(), { force: true });
  }

  apiKey(): string | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.credentialsPath(), 'utf8'));
      const key = (parsed as { anthropicApiKey?: unknown }).anthropicApiKey;
      return typeof key === 'string' && key ? key : undefined;
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.killPending();
  }

  /** Advisory: a CLI too old to answer just leaves the version out of the status. */
  private cliVersion(): Promise<string | undefined> {
    this.version ??= this.run(['--version']).then((result) =>
      result.code === 0 ? parseVersion(result.stdout) : undefined,
    );
    return this.version;
  }

  private credentialsPath(): string {
    return join(this.options.dataDir, 'credentials.json');
  }

  private killPending(): void {
    const login = this.pending;
    this.pending = undefined;
    login?.child.kill();
  }

  private run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = this.spawnCli(args);
      let stdout = '';
      let stderr = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));
      child.once('error', () => resolve({ code: null, stdout, stderr }));
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin?.end();
    });
  }

  private spawnCli(args: string[]): ChildProcess {
    return this.spawn(this.options.binary, args, {
      env: this.childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  /** Claude refuses to run nested inside itself, and the runner may well be its child. */
  private childEnv(): NodeJS.ProcessEnv {
    const env = { ...this.options.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    if (this.options.configDir) env.CLAUDE_CONFIG_DIR = this.options.configDir;
    return env;
  }
}

/**
 * The wording around it changes between releases, so anchor on the `visit:` line and
 * fall back to any URL. Partial lines are skipped: a chunk can split a URL in half.
 */
function findAuthUrl(output: string): string | undefined {
  const lines = output.split(/\r?\n/).slice(0, -1);
  const visit = lines.find((line) => line.includes('visit:') && line.includes('https://'));
  const found = visit ?? lines.find((line) => line.includes('https://'));
  return found ? /https:\/\/\S+/.exec(found)?.[0] : undefined;
}

/** `claude --version` prints `2.1.267 (Claude Code)`; only the number is worth showing. */
function parseVersion(stdout: string): string | undefined {
  return /\d+(?:\.\d+)+/.exec(stdout)?.[0];
}

function parseStatus(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** `<reason>: <whatever the CLI last said>`, so a rejected code is not a silent failure. */
function failure(reason: string, output: string): string {
  const last = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return last ? `${reason}: ${last}` : reason;
}
