import { logger } from "./logger";

let cachedText: string | null = null;
let cachedUrl: string | null = null;

export async function getResumeText(resumeUrl: string): Promise<string> {
  if (cachedUrl === resumeUrl && cachedText !== null) {
    return cachedText;
  }

  try {
    const response = await fetch(resumeUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      logger.warn({ resumeUrl, status: response.status }, "resumeReader: failed to download resume");
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());

    let text = "";
    if (contentType.includes("pdf") || resumeUrl.toLowerCase().includes(".pdf")) {
      // pdf-parse is externalized in build.mjs so use require() at runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
      const parsed = await pdfParse(buffer);
      text = parsed.text.replace(/\s+/g, " ").trim();
    } else {
      // Plain text or HTML resume
      text = buffer.toString("utf8").replace(/\s+/g, " ").trim();
    }

    if (text.length > 50) {
      cachedUrl = resumeUrl;
      cachedText = text;
    }

    return text;
  } catch (err) {
    logger.warn({ resumeUrl, err }, "resumeReader: exception reading resume");
    return "";
  }
}
