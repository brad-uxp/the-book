import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_EMAILS } from "@/auth";
import { signToken } from "@/lib/jwt";

async function verifyGoogleIdToken(
  idToken: string
): Promise<{ email: string } | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;

  const payload = (await res.json()) as {
    email?: string;
    aud?: string;
    email_verified?: string;
  };

  // Verify audience matches our web client ID
  if (payload.aud !== process.env.AUTH_GOOGLE_ID) return null;
  if (payload.email_verified !== "true") return null;
  if (!payload.email) return null;

  return { email: payload.email };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, secret, google_id_token } = body as {
      email?: string;
      secret?: string;
      google_id_token?: string;
    };

    // Google Sign-In flow
    if (google_id_token) {
      const googleUser = await verifyGoogleIdToken(google_id_token);

      if (!googleUser || !ALLOWED_EMAILS.includes(googleUser.email)) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      const { access_token, expires_in } = await signToken(googleUser.email);
      return NextResponse.json({ access_token, expires_in });
    }

    // Legacy secret flow
    if (!email || !secret) {
      return NextResponse.json(
        { error: "email and secret are required, or provide google_id_token" },
        { status: 400 }
      );
    }

    if (secret !== process.env.MOBILE_AUTH_SECRET) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (!ALLOWED_EMAILS.includes(email)) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const { access_token, expires_in } = await signToken(email);

    return NextResponse.json({ access_token, expires_in });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500 }
    );
  }
}
