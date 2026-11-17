import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { uuidv7 } from '@custock/core';
import type { AppEnv, Config } from './types';
import { localeMiddleware, orgContext, requireAuth } from './lib/context';
import { ApiProblem } from './lib/problem';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { customerRoutes as customerAppRoutes } from './routes/customer';
import { customerRoutes } from './routes/customers';
import { orgRoutes } from './routes/org';
import { postRoutes } from './routes/posts';
import { publicRoutes } from './routes/public';
import { reportRoutes } from './routes/reports';
import { teamRoutes } from './routes/team';
import { stockWriteRoutes } from './routes/stock-writes';
import { postWriteRoutes } from './routes/post-writes';
import { teamWriteRoutes } from './routes/team-writes';
import { peopleWriteRoutes } from './routes/people-writes';
import { devRoutes } from './routes/dev';
import { stockExtraRoutes } from './routes/stock-extra';

export function createApp(cfg: Config) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('cfg', cfg);
    const id = c.req.header('X-Request-Id') ?? uuidv7();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });
  app.use(
    '*',
    cors({
      origin: (origin) => (cfg.corsOrigins.includes(origin) || (cfg.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Perms-Version', 'X-Request-Id', 'Idempotency-Key', 'If-Match'],
      exposeHeaders: ['X-Perms-Stale', 'X-Request-Id', 'X-Series-Unit', 'ETag'],
      credentials: true,
    }),
  );
  app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json(new ApiProblem(413 as 400, 'validation', 'body too large').toJSON(), 413) }));
  app.use('*', localeMiddleware);

  app.get('/health', (c) => c.json({ ok: true, name: 'custock-api' }));

  app.use('/v1/me/*', requireAuth);
  app.use('/v1/orgs/:org', requireAuth, orgContext);
  app.use('/v1/orgs/:org/*', requireAuth, orgContext);

  authRoutes(app);
  orgRoutes(app);
  catalogRoutes(app);
  customerRoutes(app);
  postRoutes(app);
  teamRoutes(app);
  reportRoutes(app);
  customerAppRoutes(app);
  publicRoutes(app);
  stockWriteRoutes(app);
  postWriteRoutes(app);
  teamWriteRoutes(app);
  peopleWriteRoutes(app);
  devRoutes(app);
  stockExtraRoutes(app);

  app.notFound((c) => c.json(new ApiProblem(404, 'not_found', `${c.req.method} ${c.req.path}`).toJSON(), 404));

  app.onError((err, c) => {
    if (err instanceof ApiProblem) return c.json(err.toJSON(), err.status as 400);
    if (err instanceof ZodError) {
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.code]));
      return c.json(new ApiProblem(400, 'validation', 'invalid input', fields).toJSON(), 400);
    }
    if (err instanceof SyntaxError) return c.json(new ApiProblem(400, 'validation', 'invalid json').toJSON(), 400);
    // details stay in the server log, the body says nothing about internals
    console.error(`[${c.get('requestId')}]`, err);
    return c.json(new ApiProblem(500, 'internal').toJSON(), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
