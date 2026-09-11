import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { CodexAuthStatusData, CodexLoginStartData } from '@agent-console/contracts';
import type { SpawnCli } from './claude-auth.js';

export type CodexAuthOptions = {
  binary: string;
  /** `CODEX_HOME` for the CLI; unset means the machine default. */
  codexHome?: string | undefined;
  env: NodeJS.ProcessEnv;
  spawn?: SpawnCli;
};

type PendingLogin = {
  child: ChildProcess;
  output: string;
  code: CodexLoginStartData | undefined;
};

const PROMPT_TIMEOUT_MS = 30_000;

/** The CLI says this when the account cannot use device codes; we cannot drive a browser. */
const BROWSER_FALLBACK = 'falling back to browser login';

/**
 * Drives `codex login …` inside the environment. The device flow needs no stdin: the
 * CLI prints a code, polls OpenAI itself for up to fifteen minutes, and exits when the
 * user approves — so the child outlives the command that started it.
 */
export class CodexAuth {
  private readonly spawn: SpawnCli;
  private pending: PendingLogin | undefined;
  /** The CLI's version never changes under a running runner, so ask for it once. */
  private version: Promise<string | undefined> | undefined;
  /** Why the last login ended without a session; the next start clears it. */
  private lastError: string | undefined;

  constructor(private readonly options: CodexAuthOptions) {
    this.spawn =
      options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
  }

  /** Never throws: a CLI that cannot answer reads as not logged in. */
  async status(): Promise<CodexAuthStatusData> {
    const result = await this.run(['login', 'status']);
    // The answer goes to stderr, but read both rather than bet on which release.
    const authMethod =
      result.code === 0 ? authMethodOf(`${result.stdout}\n${result.stderr}`) : 'none';
    // Read after the probe: a login can land while it is still running.
    const pending = this.pending;
    return {
      installed: true,
      loggedIn: authMethod !== 'none',
      authMethod,
      loginPending: pending !== undefined,
      pending: pending?.code,
      version: await this.cliVersion(),
      error: this.lastError,
    };
  }

  /** Starts a device login and resolves once the CLI has printed the code to enter. */
  loginStart(): Promise<CodexLoginStartData> {
    this.cancel();
    const child = this.spawnCli(['login', '--device-auth']);
    const login: PendingLogin = { child, output: '', code: undefined };
    this.pending = login;

    return new Promise<CodexLoginStartData>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error('No device code from codex login --device-auth')),
        PROMPT_TIMEOUT_MS,
      );

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.finish(login, undefined);
        child.kill();
        reject(error);
      };

      // Stays attached after the code arrives: the tail explains a login that failed.
      const onData = (chunk: string) => {
        login.output += chunk;
        if (settled) return;
        const text = strip(login.output);
        if (text.includes(BROWSER_FALLBACK)) {
          fail(
            new Error('Codex refused the device code login; sign in with `codex login` instead'),
          );
          return;
        }
        const parsed = parsePrompt(text);
        if (!parsed) return;
        settled = true;
        clearTimeout(timer);
        login.code = parsed;
        resolve(parsed);
      };

      for (const stream of [child.stdout, child.stderr]) {
        stream?.setEncoding('utf8');
        stream?.on('data', onData);
      }
      child.once('error', fail);
      // `close` rather than `exit`: the CLI's last words can arrive after it is gone.
      child.once('close', (exitCode) => {
        if (!settled) {
          fail(new Error(failure('Login failed', strip(login.output))));
          return;
        }
        this.finish(
          login,
          exitCode === 0 ? undefined : failure('Login failed', strip(login.output)),
        );
      });
    });
  }

  cancel(): void {
    this.killPending();
    this.lastError = undefined;
  }

  async logout(): Promise<void> {
    this.cancel();
    const result = await this.run(['logout']);
    if (result.code !== 0) {
      throw new Error(failure('Logout failed', `${result.stdout}\n${result.stderr}`));
    }
  }

  /** Codex writes the key into its own `auth.json`; the runner stores nothing. */
  async setApiKey(key: string): Promise<void> {
    const result = await this.run(['login', '--with-api-key'], `${key}\n`);
    if (result.code !== 0) {
      throw new Error(failure('Could not save the API key', `${result.stdout}\n${result.stderr}`));
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

  /** A login that has since been cancelled or replaced must not clear the new one. */
  private finish(login: PendingLogin, error: string | undefined): void {
    if (this.pending !== login) return;
    this.pending = undefined;
    this.lastError = error;
  }

  private killPending(): void {
    const login = this.pending;
    this.pending = undefined;
    login?.child.kill();
  }

  private run(
    args: string[],
    input?: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
      child.stdin?.end(input);
    });
  }

  private spawnCli(args: string[]): ChildProcess {
    const command = this.options.binary;
    // npm installs @openai/codex as a `codex.cmd` shim on Windows, which needs a shell.
    const shell = /\.(cmd|bat)$/i.test(command);
    return this.spawn(shell ? `"${command}"` : command, args, {
      env: this.childEnv(),
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  private childEnv(): NodeJS.ProcessEnv {
    const env = { ...this.options.env };
    if (this.options.codexHome) env.CODEX_HOME = this.options.codexHome;
    return env;
  }
}

/** The CLI colours the url and the code, so nothing parses until the escapes are gone. */
function strip(output: string): string {
  // eslint-disable-next-line no-control-regex -- the escape byte is the point here
  return output.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * The prompt is two numbered steps, each with its payload on the line below. The last
 * line is dropped: a chunk can split the code in half, and every line the CLI prints
 * ends with a newline.
 */
function parsePrompt(text: string): CodexLoginStartData | undefined {
  const lines = text.split(/\r?\n/).slice(0, -1);
  const verificationUrl = after(lines, /^\s*1\./, (line) => /https:\/\/\S+/.exec(line)?.[0]);
  const userCode = after(lines, /^\s*2\./, (line) => line.trim() || undefined);
  return verificationUrl && userCode ? { userCode, verificationUrl } : undefined;
}

/** First line after the one `step` matches that `read` can make something of. */
function after(
  lines: string[],
  step: RegExp,
  read: (line: string) => string | undefined,
): string | undefined {
  const start = lines.findIndex((line) => step.test(line));
  if (start < 0) return undefined;
  for (const line of lines.slice(start + 1)) {
    const found = read(line);
    if (found) return found;
  }
  return undefined;
}

function authMethodOf(output: string): CodexAuthStatusData['authMethod'] {
  if (/Logged in using ChatGPT/i.test(output)) return 'chatgpt';
  if (/Logged in using an API key/i.test(output)) return 'api_key';
  if (/Logged in using (?:a |an )?(?:personal )?access token/i.test(output)) return 'access_token';
  return 'none';
}

/** `codex --version` prints `codex-cli 0.154.0`; only the number is worth showing. */
function parseVersion(stdout: string): string | undefined {
  return /\d+(?:\.\d+)+/.exec(stdout)?.[0];
}

/** `<reason>: <whatever the CLI last said>`, so a refused login is not a silent failure. */
function failure(reason: string, output: string): string {
  const last = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return last ? `${reason}: ${last}` : reason;
}
