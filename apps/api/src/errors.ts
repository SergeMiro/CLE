export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, 'unprocessable', message, details);
export const tooManyRequests = (message = 'rate limit exceeded') => new HttpError(429, 'rate_limited', message);
