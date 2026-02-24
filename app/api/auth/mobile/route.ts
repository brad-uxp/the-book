import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_EMAILS } from "@/auth";
import { signToken } from "@/lib/jwt";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, secret } = body as { email?: string; secret?: string };

  if (!email || !secret) {
    return NextResponse.json(
      { error: "email and secret are required" },
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
