import { fail } from './response.js';

export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError     extends AppError { constructor(m = 'Invalid request', d) { super(400, 'VALIDATION_ERROR', m, d); } }
export class AuthenticationError extends AppError { constructor(m = 'Authentication required') { super(401, 'UNAUTHENTICATED', m); } }
export class AuthorizationError  extends AppError { constructor(m = 'Not permitted') { super(403, 'FORBIDDEN', m); } }
export class NotFoundError       extends AppError { constructor(m = 'Resource not found') { super(404, 'NOT_FOUND', m); } }
export class ConflictError       extends AppError { constructor(code = 'CONFLICT', m = 'Conflict') { super(409, code, m); } }
export class FileUploadError     extends AppError { constructor(statusCode = 400, code = 'FILE_UPLOAD_ERROR', m = 'Upload failed') { super(statusCode, code, m); } }

export function createErrorHandler({ isProduction }) {
  return function errorHandler(error, request, reply) {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(fail(error.code, error.message, error.details));
    }
    if (error.validation) {
      return reply.code(400).send(fail('VALIDATION_ERROR', 'Invalid request', error.validation.map((v) => v.message)));
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send(fail('PAYLOAD_TOO_LARGE', 'Payload too large'));
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(fail('BAD_REQUEST', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    const message = isProduction ? 'Internal server error' : error.message;
    return reply.code(500).send(fail('INTERNAL_ERROR', message));
  };
}

export function notFoundHandler(request, reply) {
  reply.code(404).send(fail('NOT_FOUND', `Route ${request.method} ${request.url.split('?')[0]} not found`));
}
