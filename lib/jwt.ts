import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

interface TokenPayload {
  email: string;
}

export async function signToken(
  email: string
): Promise<{ access_token: string; expires_in: number }> {
  const access_token = await new SignJWT({ email } satisfies TokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(secret);
  return { access_token, expires_in: 0 };
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}
