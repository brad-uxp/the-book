import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

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
