import bcrypt from 'bcrypt';
import { AuthenticationError } from '../../utils/errors.js';

export const BCRYPT_COST = 10; // SRS: bcrypt cost factor 10

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);

export const normalizeEmail = (email) => email.trim().toLowerCase();

// Compared against when the email is unknown, so an unknown email costs about the
// same time as a wrong password (limits user enumeration through response timing).
let dummyHash;
const getDummyHash = () => (dummyHash ??= hashPassword('timing-equalisation-only'));

/** Returns the public user fields on success; throws the same generic 401 on every failure. */
export async function verifyCredentials(db, { email, password }) {
  const row = db
    .prepare('SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?')
    .get(normalizeEmail(email));

  const matches = await bcrypt.compare(password, row ? row.password_hash : await getDummyHash());
  if (!row || !matches) throw new AuthenticationError('Invalid credentials');

  return { id: row.id, full_name: row.full_name, email: row.email, role: row.role };
}
