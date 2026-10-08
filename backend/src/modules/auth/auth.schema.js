// No `format: email` on purpose: every bad login, including a malformed email,
// should produce the same 401 rather than a distinguishable 400.
export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 1, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};
