import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
const server = await startServer(config);

console.log(
  `runner listening on ws://127.0.0.1:${server.port} (agent=${config.agent}, cwd=${config.cwd})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
