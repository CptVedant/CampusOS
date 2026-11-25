import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as controller from './enrollments.controller.js';
import { enrollSchema, listEnrollmentsSchema, removeEnrollmentSchema, searchStudentsSchema } from './enrollments.schema.js';

const staffOnly = [authenticate, authorize('teacher', 'admin')];

export default async function enrollmentRoutes(app) {
  app.post('/api/courses/:courseId/enrollments', { onRequest: staffOnly, schema: enrollSchema }, controller.enroll);
  app.get('/api/courses/:courseId/enrollments', { onRequest: staffOnly, schema: listEnrollmentsSchema }, controller.list);
  app.delete(
    '/api/courses/:courseId/enrollments/:studentId',
    { onRequest: staffOnly, schema: removeEnrollmentSchema },
    controller.remove,
  );
  app.get(
    '/api/courses/:courseId/students/search',
    { onRequest: staffOnly, schema: searchStudentsSchema },
    controller.search,
  );
  app.get('/api/me/courses', { onRequest: [authenticate, authorize('student')] }, controller.myCourses);
}
