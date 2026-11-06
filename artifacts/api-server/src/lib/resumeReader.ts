import { PDFParse } from "pdf-parse";
import { ObjectStorageService } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { logger } from "./logger";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** Only private storage references are accepted; never fetch a user-supplied URL. */
export function resumeObjectPath(value: string): string {
  const path = value.startsWith("/api/storage/") ? value.slice("/api/storage".length) : value;
  if (!/^\/objects\/uploads\/[a-zA-Z0-9_-]+$/.test(path)) {
    throw new Error("Upload your resume using Career Scout or paste its text");
  }
  return path;
}

export async function assertResumeOwnership(value: string, userId: string) {
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(resumeObjectPath(value));
  if (!await storage.canAccessObjectEntity({ userId, objectFile: file, requestedPermission: ObjectPermission.READ })) {
    throw new Error("Resume not found or not owned by this account");
  }
  return file;
}

export async function getResumeText(resumeUrl: string, userId: string): Promise<string> {
  try {
    const file = await assertResumeOwnership(resumeUrl, userId);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > MAX_RESUME_BYTES) throw new Error("Resume exceeds 10 MB");
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = file.createReadStream();
    const timer = setTimeout(() => stream.destroy(new Error("Resume read timed out")), 10_000);
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_RESUME_BYTES) throw new Error("Resume exceeds 10 MB");
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, 5).toString() === "%PDF-") {
      const parser = new PDFParse({ data });
      try { return (await parser.getText()).text.replace(/\s+/g, " ").trim(); }
      finally { await parser.destroy(); }
    }
    return data.toString("utf8").replace(/\s+/g, " ").trim();
  } catch (err) {
    logger.warn({ err }, "resumeReader: could not read owned resume");
    return "";
  }
}
