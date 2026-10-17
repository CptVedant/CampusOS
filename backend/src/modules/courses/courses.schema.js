import { UUID_PATTERN } from '../../utils/validation.js';

const uuid = { type: 'string', pattern: UUID_PATTERN };
// pattern '\S' = must contain at least one non-whitespace character (rejects "   ").
const nonBlank = (maxLength) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });

export const courseParams = {
  type: 'object',
  required: ['courseId'],
  properties: { courseId: uuid },
};

export const createCourseSchema = {
  body: {
    type: 'object',
    required: ['course_code', 'title'],
    additionalProperties: false,
    properties: {
      course_code: nonBlank(32),
      title: nonBlank(200),
      teacher_id: uuid, // required for admins, optional for teachers (defaults to self)
    },
  },
};

export const getCourseSchema = { params: courseParams };
export const deleteCourseSchema = { params: courseParams };

export const updateCourseSchema = {
  params: courseParams,
  body: {
    type: 'object',
    required: ['course_code', 'title'],
    additionalProperties: false,
    properties: {
      course_code: nonBlank(32),
      title: nonBlank(200),
      teacher_id: uuid, // reassignment: admin only
    },
  },
};
