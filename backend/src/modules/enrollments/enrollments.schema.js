import { UUID_PATTERN } from '../../utils/validation.js';

const uuid = { type: 'string', pattern: UUID_PATTERN };

const courseParams = {
  type: 'object',
  required: ['courseId'],
  properties: { courseId: uuid },
};

export const enrollSchema = {
  params: courseParams,
  body: {
    type: 'object',
    required: ['student_id'],
    additionalProperties: false,
    properties: { student_id: uuid },
  },
};

export const listEnrollmentsSchema = { params: courseParams };

export const removeEnrollmentSchema = {
  params: {
    type: 'object',
    required: ['courseId', 'studentId'],
    properties: { courseId: uuid, studentId: uuid },
  },
};

export const searchStudentsSchema = {
  params: courseParams,
  querystring: {
    type: 'object',
    required: ['q'],
    additionalProperties: false,
    properties: { q: { type: 'string', maxLength: 254 } },
  },
};
