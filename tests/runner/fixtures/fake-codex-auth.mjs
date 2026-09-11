// Scripted stand-in for `codex login …`: prints what the real CLI prints, down to the
// colour codes around the url and the code, and keeps its credentials in CODEX_HOME.
// The device login waits for an `approve` or `deny` file rather than a browser.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearInterval, setInterval } from 'node:timers';

/** What the CLI wraps the url and the code in; the runner has to strip it. ESC by code
 * point, so the bytes survive an editor that eats control characters. */
const ESC = String.fromCharCode(27);
const BLUE = `${ESC}[94m`;
const RESET = `${ESC}[0m`;

const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const auth = home ? join(home, 'auth.json') : undefined;

if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\n');
} else if (args[0] === 'logout') {
  if (auth) rmSync(auth, { force: true });
  process.stderr.write('Successfully logged out\n');
} else if (args[0] !== 'login') {
  process.stderr.write(`unexpected command: ${args.join(' ')}\n`);
  process.exitCode = 2;
} else if (args[1] === 'status') {
  status();
} else if (args[1] === '--device-auth') {
  deviceAuth();
} else if (args[1] === '--with-api-key') {
  withApiKey();
} else {
  process.stderr.write(`unexpected command: ${args.join(' ')}\n`);
  process.exitCode = 2;
}

function status() {
  const mode = auth && existsSync(auth) ? JSON.parse(readFileSync(auth, 'utf8')).mode : undefined;
  if (mode === 'chatgpt') process.stderr.write('Logged in using ChatGPT\n');
  else if (mode === 'api_key') process.stderr.write('Logged in using an API key - sk-fake\n');
  else if (mode === 'access_token') process.stderr.write('Logged in using access token\n');
  else {
    process.stderr.write('Not logged in\n');
    process.exitCode = 1;
  }
}

function deviceAuth() {
  process.stdout.write('Sign in with your ChatGPT account\n\n');
  process.stdout.write('  1. Open this link in your browser and sign in to your account\n');
  process.stdout.write(`     ${BLUE}https://auth.openai.com/codex/device${RESET}\n\n`);
  process.stdout.write('  2. Enter this one-time code (expires in 15 minutes)\n');
  process.stdout.write(`     ${BLUE}ABCD-1234${RESET}\n\n`);

  // The real CLI polls OpenAI here; this one polls the filesystem for the verdict.
  const timer = setInterval(() => {
    if (!home) return;
    if (existsSync(join(home, 'approve'))) {
      clearInterval(timer);
      writeFileSync(auth, JSON.stringify({ mode: 'chatgpt' }));
      process.stderr.write('Successfully logged in\n');
    } else if (existsSync(join(home, 'deny'))) {
      clearInterval(timer);
      process.stderr.write('Error logging in with device code: denied\n');
      process.exitCode = 1;
    }
  }, 10);
}

function withApiKey() {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const key = chunks.join('').trim();
    if (key === 'sk-bad') {
      process.stderr.write('Error logging in with API key: invalid API key\n');
      process.exitCode = 1;
      return;
    }
    mkdirSync(home, { recursive: true });
    writeFileSync(auth, JSON.stringify({ mode: 'api_key' }));
    process.stderr.write('Successfully logged in\n');
  });
}
