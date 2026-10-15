// Hash functions of Better Auth's e-mail/password login (P-027, auth/auth.ts).
// argon2id with the OWASP parameters the previous @node-rs/argon2 setup used (m=19 MiB, t=2, p=1).
// Bun.password reads and writes the same PHC strings, so hashes created before the switch verify.
const ARGON2 = {
  algorithm: "argon2id",
  memoryCost: 19_456,
  timeCost: 2,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  Bun.password.hash(password, ARGON2);

export async function verifyPassword(
  passwordHash: string,
  password: string
): Promise<boolean> {
  try {
    return await Bun.password.verify(password, passwordHash);
  } catch {
    return false;
  }
}
