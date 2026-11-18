// snapshot the working tree and make the production build used by the end to end run.
//   node e2e/build.mjs
import { snapshot, buildWeb } from './env.mjs';

const t0 = Date.now();
snapshot();
console.log(`snapshot in ${Math.round((Date.now() - t0) / 1000)}s`);
const dir = buildWeb();
console.log(`built ${dir} in ${Math.round((Date.now() - t0) / 1000)}s`);
