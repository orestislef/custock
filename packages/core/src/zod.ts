// zod for every schema in core. in the browser zod must not test for eval (the content security
// policy forbids it and reports each try), so it is told up front, once, wherever a schema loads.
import { z } from 'zod';

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') z.config({ jitless: true });

export { z };
