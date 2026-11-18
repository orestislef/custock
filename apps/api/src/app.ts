import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { ownDomainsFor, setOwnDomains, uuidv7 } from '@custock/core';
import type { AppEnv, Config } from './types';
import { localeMiddleware, orgContext, requireAuth } from './lib/context';
import { ApiProblem } from './lib/problem';
import { authRoutes } from './routes/auth';
import { passwordResetRoutes } from './routes/password-reset';
import { catalogRoutes } from './routes/catalog';
import { customerRoutes as customerAppRoutes } from './routes/customer';
import { customerRoutes } from './routes/customers';
import { orgRoutes } from './routes/org';
import { categoryRoutes } from './routes/categories';
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
import { MAX_UPLOAD_BYTES, uploadRoutes } from './routes/uploads';
import { platformDevRoutes } from './routes/platform-dev';
import { setBucketBase, setFileBase } from './services/catalog';
import { setWebBase } from './lib/webpush';
import { setPlatformNotifyBase } from './lib/platform-notify';
import { pushRoutes } from './routes/push';
import { sessionRoutes } from './routes/sessions';
import { platformGuards, platformRoutes } from './routes/platform';
import { emailRoutes } from './routes/email';
import { setEmailAssetBase } from './email/layout';
import { captureServerErrors, setErrorWebBase } from './lib/errors';
import { errorRoutes } from './routes/errors';
import { policyRoutes } from './routes/policies';

export function createApp(cfg: Config) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('cfg', cfg);
    const id = c.req.header('X-Request-Id') ?? uuidv7();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });
  // every 5xx, thrown or returned, lands in the error tracker (lib/errors.ts)
  app.use('*', captureServerErrors);
  app.use(
    '*',
    cors({
      origin: (origin) => (cfg.corsOrigins.includes(origin) || (cfg.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Perms-Version', 'X-Request-Id', 'Idempotency-Key', 'If-Match'],
      exposeHeaders: ['X-Perms-Stale', 'X-Request-Id', 'X-Series-Unit', 'ETag'],
      credentials: true,
    }),
  );
  // 1 MB for json, photo uploads have their own 5 MB slot
  const tooLarge = (c: Context<AppEnv>) => c.json(new ApiProblem(413 as 400, 'validation', 'body too large').toJSON(), 413);
  const jsonLimit = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: tooLarge });
  app.use('*', (c, next) => (c.req.path.startsWith('/v1/uploads/') ? uploadLimit(c, next) : jsonLimit(c, next)));
  setFileBase(cfg.apiPublicUrl);
  setEmailAssetBase(cfg.apiPublicUrl);
  setBucketBase(cfg.storage?.kind === 's3' ? cfg.storage.s3.publicUrl : null);
  setWebBase(cfg.publicWebUrl);
  setPlatformNotifyBase(cfg.publicWebUrl);
  setErrorWebBase(cfg.publicWebUrl);
  // shelf qr codes printed with our own web address scan as the product inside them
  setOwnDomains(ownDomainsFor(cfg.publicWebUrl, ...(cfg.ownDomains ?? [])));
  app.use('*', localeMiddleware);

  app.get('/health', (c) => c.json({ ok: true, name: 'custock-api' }));

  app.use('/v1/me/*', requireAuth);
  app.use('/v1/orgs/:org', requireAuth, orgContext);
  app.use('/v1/orgs/:org/*', requireAuth, orgContext);
  // what a super admin decided (features, paused businesses, limits, platform pauses), before every route
  platformGuards(app);

  authRoutes(app);
  passwordResetRoutes(app);
  orgRoutes(app);
  categoryRoutes(app);
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
  emailRoutes(app);
  stockExtraRoutes(app);
  uploadRoutes(app);
  pushRoutes(app);
  sessionRoutes(app);
  platformRoutes(app);
  policyRoutes(app);
  errorRoutes(app);

  // the api description (super admins only in production) and the state of this server. last, so
  // the description sees every route above
  platformDevRoutes(app);

  app.notFound((c) => c.json(new ApiProblem(404, 'not_found', `${c.req.method} ${c.req.path}`).toJSON(), 404));

  app.onError((err, c) => {
    if (err instanceof ApiProblem) return c.json(err.toJSON(), err.status as 400);
    if (err instanceof ZodError) {
      // a rule from validate.ts carries its field error code (common.json field.*) as the message
      const code = (i: (typeof err.issues)[number]) => (i.code === 'custom' || /^[a-zA-Z]+$/.test(i.message ?? '') && i.message.length < 24 && i.code !== 'invalid_type' ? i.message : i.code);
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', code(i)]));
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
