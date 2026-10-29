import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { htmlToMarkdown, markdownToHtml } from "./markdown";

/**
 * The HTML the server parses is not all the editor's: an automation token can
 * store any HTML through the REST API. Parsing it must never reach the
 * network — from Railway, that would be a request into its private network
 * (SSRF). Every way HTML can make a browser fetch, against a server that
 * counts what reaches it.
 */
describe("parsear HTML guardado no sale a la red", () => {
  it("ningún request llega, con ningún vector", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const vectors = [
      `<link rel="preload" as="fetch" href="${base}/preload">`,
      `<link rel="preload" as="script" href="${base}/preload-script">`,
      `<link rel="prefetch" href="${base}/prefetch">`,
      `<link rel="modulepreload" href="${base}/modulepreload">`,
      `<link rel="stylesheet" href="${base}/stylesheet">`,
      `<link rel="icon" href="${base}/icon">`,
      `<style>@import url("${base}/import"); p { background: url(${base}/bg) }</style>`,
      `<script src="${base}/script"></script>`,
      `<script type="module">import "${base}/module";</script>`,
      `<iframe src="${base}/iframe"></iframe>`,
      `<img src="${base}/img"><img srcset="${base}/srcset 2x">`,
      `<video src="${base}/video" poster="${base}/poster"></video><audio src="${base}/audio"></audio>`,
      `<object data="${base}/object"></object><embed src="${base}/embed">`,
      `<meta http-equiv="refresh" content="0;url=${base}/refresh">`,
      `<base href="${base}/base/"><a href="rel">a</a>`,
      `<form action="${base}/form"><input type="image" src="${base}/input"></form>`,
      `<svg><image href="${base}/svg-image"></image><use href="${base}/svg-use#x"></use></svg>`,
    ];
    const html = `<p>text</p>${vectors.join("")}`;

    try {
      htmlToMarkdown(html);
      markdownToHtml(html); // the markdown parser leaves HTML as text, but the result is parsed again
      // Anything a parse started would be on its way by now.
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(hits).toEqual([]);
  });
});
