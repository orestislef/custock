// starts the throwaway api and the built web and keeps them running, for writing tests by hand.
//   node e2e/serve.mjs     (ctrl+c to stop)
import { builtStandalone, startApi, startWeb, stopAll } from './env.mjs';
import cfg from './e2e.config.mjs';

const dir = builtStandalone();
if (!dir) throw new Error('no build yet, run node e2e/build.mjs first');
await startApi();
await startWeb(dir);
console.log(`ready: http://localhost:${cfg.webPort}${cfg.basePath} (api ${cfg.apiPort})`);
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });
setInterval(() => {}, 1 << 30);
