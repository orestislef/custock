// RFC 9457 problem+json with a stable code the apps translate. no prose for the ui.

import type { ErrorCode } from '@custock/core';

const TITLES: Record<string, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  412: 'Precondition Failed', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error',
};

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(detail ?? code);
  }

  toJSON() {
    return {
      type: `https://custock.app/errors/${this.code}`,
      title: TITLES[this.status] ?? 'Error',
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}

export const notFound = (detail?: string) => new ApiProblem(404, 'not_found', detail);
export const forbidden = (detail?: string, code: ErrorCode = 'forbidden') => new ApiProblem(403, code, detail);
export const unauthorized = (detail?: string) => new ApiProblem(401, 'unauthorized', detail);
export const badRequest = (detail?: string, fields?: Record<string, string>) => new ApiProblem(400, 'validation', detail, fields);
