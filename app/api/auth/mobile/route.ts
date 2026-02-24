import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { ALLOWED_EMAILS } from "@/auth";
import { signToken } from "@/lib/jwt";

const googleClient = new OAuth2Client(process.env.AUTH_GOOGLE_ID);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, secret, google_id_token } = body as {
    email?: string;
    secret?: string;
    google_id_token?: string;
  };

  // Google Sign-In flow
  if (google_id_token) {
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: google_id_token,
        audience: process.env.AUTH_GOOGLE_ID,
      });
      const payload = ticket.getPayload();
      const googleEmail = payload?.email;

      if (!googleEmail || !ALLOWED_EMAILS.includes(googleEmail)) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      const { access_token, expires_in } = await signToken(googleEmail);
      return NextResponse.json({ access_token, expires_in });
    } catch {
      return NextResponse.json(
        { error: "Invalid Google token" },
        { status: 401 }
      );
    }
  }

  // Legacy secret flow
  if (!email || !secret) {
    return NextResponse.json(
      { error: "email and secret are required, or provide google_id_token" },
      { status: 400 }
    );
  }

  if (secret !== process.env.MOBILE_AUTH_SECRET) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!ALLOWED_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const { access_token, expires_in } = await signToken(email);

  return NextResponse.json({ access_token, expires_in });
}
