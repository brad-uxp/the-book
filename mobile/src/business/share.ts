import { Share } from "react-native";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { invoiceTitle, type InvoiceItem } from "./invoices";

/**
 * Shares an invoice's PDF through Android's share sheet.
 *
 * The server hands out a link that expires in ten minutes (a presigned R2
 * URL) — the phone never holds a key to the bucket. The PDF is downloaded
 * into the app's cache, into a folder emptied before each download, so at
 * most one invoice sits on the phone at a time. An invoice whose file is an
 * external link shares the link instead.
 */
export async function shareInvoicePdf(
  invoice: InvoiceItem,
  call: <T>(path: string) => Promise<T>
): Promise<void> {
  const { url, kind } = await call<{ url: string; kind: "r2" | "external" }>(`/api/invoices/${invoice.id}/download-url`);
  const title = invoiceTitle(invoice);

  if (kind === "external") {
    await Share.share({ message: url, title });
    return;
  }

  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files.");

  const folder = new Directory(Paths.cache, "invoices");
  if (folder.exists) folder.delete();
  folder.create({ intermediates: true });
  const name = `${title.replace(/[^\w.-]+/g, "-")}.pdf`;
  const file = await File.downloadFileAsync(url, new File(folder, name), { idempotent: true });
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: title, UTI: "com.adobe.pdf" });
}
