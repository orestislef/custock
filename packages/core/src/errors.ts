// errors seen in production, for the super admin: issues grouped by fingerprint, and what a
// browser may report about itself. nothing personal goes in here.

import { z } from './zod';

export const IssueKind = z.enum(['api', 'worker', 'send', 'storage', 'client']);
export type IssueKind = z.infer<typeof IssueKind>;

export const IssueStatus = z.enum(['open', 'resolved', 'ignored']);
export type IssueStatus = z.infer<typeof IssueStatus>;

// the newest occurrence of an issue, scrubbed: no emails, tokens, passwords, cookies, bodies or
// query strings. user and org are ids only
export const IssueExample = z.object({
  at: z.number(),
  message: z.string(),
  stack: z.string().nullable(),
  method: z.string().nullable(),
  route: z.string().nullable(),
  status: z.number().int().nullable(),
  release: z.string().nullable(),
  userId: z.string().nullable(),
  orgId: z.string().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  build: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type IssueExample = z.infer<typeof IssueExample>;

export const Issue = z.object({
  id: z.string(),
  kind: IssueKind,
  title: z.string(),
  route: z.string().nullable(),
  frame: z.string().nullable(),
  status: IssueStatus,
  count: z.number().int(),
  firstSeen: z.number(),
  lastSeen: z.number(),
  resolvedAt: z.number().nullable(),
});
export type Issue = z.infer<typeof Issue>;

export const IssueDetail = Issue.extend({
  example: IssueExample,
  orgName: z.string().nullable(),
});
export type IssueDetail = z.infer<typeof IssueDetail>;

export const IssueCounts = z.object({ open: z.number().int(), resolved: z.number().int(), ignored: z.number().int() });
export type IssueCounts = z.infer<typeof IssueCounts>;

export const IssuePage = z.object({
  items: z.array(Issue),
  nextCursor: z.string().nullable(),
  counts: IssueCounts,
});
export type IssuePage = z.infer<typeof IssuePage>;

export interface IssueQuery {
  status?: IssueStatus | 'all';
  kind?: IssueKind;
  q?: string;
  cursor?: string;
}

// what a browser reports. families only, never the user agent string
export const CLIENT_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'opera', 'other'] as const;
export const CLIENT_OSES = ['ios', 'android', 'windows', 'macos', 'linux', 'chromeos', 'other'] as const;

export const ClientErrorInput = z
  .object({
    // window error, unhandled promise rejection, a react error boundary, an api call that failed with 5xx
    source: z.enum(['error', 'rejection', 'boundary', 'api']),
    message: z.string().trim().min(1).max(500),
    stack: z.string().max(4000).optional(),
    // the page, without its query string
    path: z.string().max(300).regex(/^\/[^?#\s]*$/),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    apiPath: z.string().max(300).regex(/^\/[^?#\s]*$/).optional(),
    status: z.number().int().min(500).max(599).optional(),
    browser: z.enum(CLIENT_BROWSERS),
    os: z.enum(CLIENT_OSES),
    build: z.string().max(64).regex(/^[A-Za-z0-9._-]*$/).optional(),
  })
  .strict();
export type ClientErrorInput = z.infer<typeof ClientErrorInput>;
