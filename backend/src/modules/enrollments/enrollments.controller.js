import { ok } from '../../utils/response.js';
import { listEnrolledCourses } from '../courses/courses.service.js';
import * as enrollments from './enrollments.service.js';

export async function enroll(request, reply) {
  const { db } = request.server;
  const row = enrollments.enrollStudent(db, request.user, request.params.courseId, request.body.student_id);
  return reply.code(201).send(ok(row));
}

export async function list(request) {
  return ok(enrollments.listEnrollments(request.server.db, request.user, request.params.courseId));
}

export async function remove(request) {
  const { courseId, studentId } = request.params;
  return ok(enrollments.removeEnrollment(request.server.db, request.user, courseId, studentId));
}

// Identity comes only from the verified JWT; the route accepts no student id.
export async function myCourses(request) {
  return ok(listEnrolledCourses(request.server.db, request.user.sub));
}
