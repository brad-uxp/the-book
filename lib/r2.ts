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
    });
  }
  return cachedClient;
}

export const r2BucketName = () => bucket!;

export function buildInvoiceKey(invoiceId: string): string {
  return `invoices/${invoiceId}/${randomUUID()}.pdf`;
}

export async function getUploadUrl(key: string, contentType = "application/pdf", expiresIn = 300): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: bucket!, Key: key, ContentType: contentType });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

export async function getDownloadUrl(key: string, expiresIn = 600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket!, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
}
