import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as controller from './courses.controller.js';
import {
  createCourseSchema,
  deleteCourseSchema,
  getCourseSchema,
  updateCourseSchema,
} from './courses.schema.js';

// onRequest hooks run before body parsing/validation, so a student gets 403 (not 400) on staff routes.
const anyUser = [authenticate];
const staffOnly = [authenticate, authorize('teacher', 'admin')];

export default async function courseRoutes(app) {
  app.get('/api/courses', { onRequest: anyUser }, controller.listCourses);
  app.get('/api/courses/:courseId', { onRequest: anyUser, schema: getCourseSchema }, controller.getCourse);
  app.post('/api/courses', { onRequest: staffOnly, schema: createCourseSchema }, controller.createCourse);
  app.put('/api/courses/:courseId', { onRequest: staffOnly, schema: updateCourseSchema }, controller.updateCourse);
  app.delete('/api/courses/:courseId', { onRequest: staffOnly, schema: deleteCourseSchema }, controller.deleteCourse);
}
