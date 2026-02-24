import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

interface TokenPayload {
  email: string;
}

export async function signToken(
  email: string
): Promise<{ access_token: string; expires_in: number }> {
  const expires_in = 60 * 60 * 24 * 7; // 7 days
  const access_token = await new SignJWT({ email } satisfies TokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${expires_in}s`)
    .setIssuedAt()
    .sign(secret);
  return { access_token, expires_in };
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
