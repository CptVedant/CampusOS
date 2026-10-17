import { ok } from '../../utils/response.js';
import * as courses from './courses.service.js';

export async function listCourses(request) {
  return ok(courses.listCourses(request.server.db, request.user));
}

export async function getCourse(request) {
  return ok(courses.getCourse(request.server.db, request.user, request.params.courseId));
}

export async function createCourse(request, reply) {
  const course = courses.createCourse(request.server.db, request.user, request.body);
  return reply.code(201).send(ok(course));
}

export async function updateCourse(request) {
  return ok(courses.updateCourse(request.server.db, request.user, request.params.courseId, request.body));
}

export async function deleteCourse(request) {
  return ok(courses.deleteCourse(request.server.db, request.user, request.params.courseId));
}
