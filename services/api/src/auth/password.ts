import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(pbkdf2);
const ITERATIONS = 600_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await derive(password, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2_sha256$${ITERATIONS}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, rawIterations, rawSalt, rawExpected] = encoded.split("$");
    if (algorithm !== "pbkdf2_sha256") return false;
    const expected = Buffer.from(rawExpected, "base64url");
    const digest = await derive(password, Buffer.from(rawSalt, "base64url"), Number(rawIterations), expected.length, "sha256");
    return digest.length === expected.length && timingSafeEqual(digest, expected);
  } catch {
    return false;
  }
}

export function safeSecretEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
