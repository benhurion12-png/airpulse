import { hashPassword, verifyPassword } from "./password";

describe("password compatibility", () => {
  it("creates and verifies the PBKDF2 format used by the previous API", async () => {
    const encoded = await hashPassword("StrongPass1");
    expect(encoded).toMatch(/^pbkdf2_sha256\$600000\$/);
    await expect(verifyPassword("StrongPass1", encoded)).resolves.toBe(true);
    await expect(verifyPassword("WrongPass1", encoded)).resolves.toBe(false);
  });
});
