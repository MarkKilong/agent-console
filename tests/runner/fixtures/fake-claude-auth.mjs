// Scripted stand-in for `claude auth …`: prints what the real CLI prints and keeps
// its credentials in CLAUDE_CONFIG_DIR, so the auth flow can be tested without the
// binary (and without opening a browser). `good-code` is the only code it accepts.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR;
const credentials = configDir ? join(configDir, '.credentials.json') : undefined;

if (args[0] === '--version') {
  process.stdout.write('9.9.9 (Claude Code)\n');
} else if (args[0] !== 'auth') {
  process.stderr.write(`unexpected command: ${args.join(' ')}\n`);
  process.exitCode = 2;
} else if (args[1] === 'status') {
  process.stdout.write(`${JSON.stringify(status())}\n`);
} else if (args[1] === 'login') {
  login();
} else if (args[1] === 'logout') {
  if (credentials) rmSync(credentials, { force: true });
  process.stdout.write('Logged out\n');
} else {
  process.stderr.write(`unexpected command: ${args.join(' ')}\n`);
  process.exitCode = 2;
}

function status() {
  if (!credentials || !existsSync(credentials)) return { loggedIn: false, authMethod: 'none' };
  return {
    loggedIn: true,
    authMethod: 'claude.ai',
    email: 'dev@example.com',
    orgName: 'Example',
    subscriptionType: 'max',
  };
}

function login() {
  process.stdout.write('Opening browser to sign in…\n');
  process.stdout.write(
    "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake\n",
  );
  process.stdout.write('Paste code here if prompted > ');

  const lines = createInterface({ input: process.stdin });
  lines.once('line', (line) => {
    lines.close();
    process.stdin.destroy();
    if (line.trim() !== 'good-code') {
      process.stdout.write('Invalid code\n');
      process.exitCode = 1;
      return;
    }
    if (credentials) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: 'fake' } }));
    }
    process.stdout.write('Login successful\n');
  });
}
