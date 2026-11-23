import { OTP_PATTERN, UUID_PATTERN } from '../../utils/validation.js';

const uuid = { type: 'string', pattern: UUID_PATTERN };

export const startSchema = {
  body: {
    type: 'object',
    required: ['course_id'],
    additionalProperties: false,
    properties: { course_id: uuid },
  },
};

export const stopSchema = {
  body: {
    type: 'object',
    required: ['session_id'],
    additionalProperties: false,
    properties: { session_id: uuid },
  },
};

// No student_id on purpose: identity comes from the JWT. Unknown properties are dropped.
export const punchSchema = {
  body: {
    type: 'object',
    required: ['session_id', 'otp', 'device_fingerprint'],
    additionalProperties: false,
    properties: {
      session_id: uuid,
      otp: { type: 'string', pattern: OTP_PATTERN },
      device_fingerprint: uuid, // the frontend generates a UUID and keeps it in localStorage
    },
  },
};

export const historySchema = {
  querystring: { type: 'object', properties: { course_id: uuid } },
};

export const listSessionsSchema = {
  querystring: { type: 'object', required: ['course_id'], properties: { course_id: uuid } },
};

const sessionParams = {
  type: 'object',
  required: ['sessionId'],
  properties: { sessionId: uuid },
};

export const sessionDetailSchema = { params: sessionParams };

export const markPresentSchema = {
  params: sessionParams,
  body: {
    type: 'object',
    required: ['student_id'],
    additionalProperties: false,
    properties: { student_id: uuid },
  },
};

export const removeRecordSchema = {
  params: {
    type: 'object',
    required: ['sessionId', 'studentId'],
    properties: { sessionId: uuid, studentId: uuid },
  },
};
