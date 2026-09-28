import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { APK_CONTENT_TYPE, isReleaseKey } from "./mobile-releases";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;
const endpoint = process.env.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 not configured: set R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return cachedClient;
}

export const r2BucketName = () => bucket!;

/**
 * The exact shape buildInvoiceKey produces. Object keys arrive from the client
 * (they round-trip through Invoice.file_key), so anything that reaches the
 * presigner must be checked against this — a free-form key lets a caller sign
 * a URL for, or delete, any object in the bucket.
 */
const INVOICE_KEY_RE =
  /^invoices\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export function isInvoiceKey(key: string): boolean {
  return INVOICE_KEY_RE.test(key);
}

/** True only when `key` is a well-formed key belonging to THIS invoice. */
export function isInvoiceKeyFor(key: string, invoiceId: string): boolean {
  return isInvoiceKey(key) && key.startsWith(`invoices/${invoiceId}/`);
}

export function buildInvoiceKey(invoiceId: string): string {
  return `invoices/${invoiceId}/${randomUUID()}.pdf`;
}

/**
 * Last line of defence before a key becomes a signed URL or a delete. Callers
 * are expected to have checked ownership already (isInvoiceKeyFor); this stops
 * a malformed key from ever reaching the bucket if one forgets.
 */
function assertSafeKey(key: string): void {
  if (!isInvoiceKey(key)) {
    throw new Error("Refusing to operate on an unrecognised object key");
  }
}

export async function getUploadUrl(key: string, contentType = "application/pdf", expiresIn = 300): Promise<string> {
  assertSafeKey(key);
  const client = getClient();
  const cmd = new PutObjectCommand({ Bucket: bucket!, Key: key, ContentType: contentType });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function getDownloadUrl(key: string, expiresIn = 600): Promise<string> {
  assertSafeKey(key);
  const client = getClient();
  const cmd = new GetObjectCommand({ Bucket: bucket!, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  assertSafeKey(key);
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
}

// ── App releases (mobile/releases/…) ─────────────────────────────────────────
//
// Separate from the invoice helpers on purpose: each set checks its own key
// shape, so an invoice route can never sign a URL for a build or the other
// way round.

function assertReleaseKey(key: string): void {
  if (!isReleaseKey(key)) {
    throw new Error("Refusing to operate on an unrecognised release key");
  }
}

/**
 * A URL the release script PUTs the signed APK to. Content type and length
 * are signed into it, so the upload must be exactly the declared file size.
 */
export async function getReleaseUploadUrl(
  key: string,
  sizeBytes: number,
  expiresIn: number
): Promise<string> {
  assertReleaseKey(key);
  const cmd = new PutObjectCommand({
    Bucket: bucket!,
    Key: key,
    ContentType: APK_CONTENT_TYPE,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(getClient(), cmd, {
    expiresIn,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

/** A short-lived URL the phone downloads a published build from. */
export async function getReleaseDownloadUrl(key: string, expiresIn: number): Promise<string> {
  assertReleaseKey(key);
  const cmd = new GetObjectCommand({ Bucket: bucket!, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

/** How many bytes R2 holds for a build, or null when nothing was uploaded. */
export async function releaseObjectSize(key: string): Promise<number | null> {
  assertReleaseKey(key);
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: bucket!, Key: key }));
    return head.ContentLength ?? null;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

