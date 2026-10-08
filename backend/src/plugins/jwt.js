import fastifyJwt from '@fastify/jwt';

/**
 * Registers @fastify/jwt on the app. The secret always comes from injected config
 * (which env.js reads from the environment). Algorithms are pinned to HS256 so
 * "alg: none" and algorithm-confusion tokens are rejected.
 */
export function registerJwt(app, config) {
  app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: config.jwtExpiresIn ?? '8h' },
    verify: { algorithms: ['HS256'] },
  });
}
