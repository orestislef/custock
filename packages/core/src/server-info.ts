// what a super admin sees about the running server (GET /v1/platform/server) and the shape of
// the api description the docs screen reads (GET /v1/openapi.json). nothing secret ever goes in
// here: no keys, no passwords, no tokens, only on or off and hostnames.

import { z } from 'zod';

export const ServerInfo = z.object({
  build: z.object({
    // git short hash and ISO date the image was built from, null in dev
    rev: z.string().nullable(),
    builtAt: z.string().nullable(),
  }),
  runtime: z.object({
    mode: z.enum(['dev', 'production']),
    node: z.string(),
    startedAt: z.number().int(),
    uptimeSeconds: z.number().int(),
  }),
  database: z.object({
    bytes: z.number().int(),
    walBytes: z.number().int(),
    migrations: z.array(z.object({ name: z.string(), appliedAt: z.number().int() })),
  }),
  sending: z.object({
    // outbox keeps every email and push in the database, live sends them
    transport: z.enum(['outbox', 'live']),
    email: z.object({ on: z.boolean(), host: z.string().nullable() }),
    webpush: z.object({ on: z.boolean() }),
    fcm: z.object({ on: z.boolean() }),
  }),
  storage: z.object({
    kind: z.enum(['local', 's3', 'off']),
    host: z.string().nullable(),
    bucket: z.string().nullable(),
    publicHost: z.string().nullable(),
  }),
  worker: z.object({
    // false when the worker is switched off or has not run in the last minute
    running: z.boolean(),
    lastRunAt: z.number().int().nullable(),
    // due now and waiting, due later, given up after every attempt
    queued: z.number().int(),
    scheduled: z.number().int(),
    failed: z.number().int(),
  }),
  outbox: z.object({
    // the last 24 hours
    sent: z.number().int(),
    failed: z.number().int(),
    waiting: z.number().int(),
  }),
});
export type ServerInfo = z.infer<typeof ServerInfo>;

// the parts of an OpenAPI 3.1 document the docs screen reads
export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: 'path' | 'query' | 'header'; required?: boolean; schema?: unknown; description?: string }[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
  // who may call it: public, signed in, a member of the business, or a super admin
  'x-access'?: 'public' | 'user' | 'org' | 'superadmin';
  // permission keys the handler checks, any one of them
  'x-permissions'?: string[];
  // stable problem codes the handler can answer with
  'x-errors'?: string[];
}

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
}
