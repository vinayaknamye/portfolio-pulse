import fs from 'fs';
import path from 'path';
import { extractText } from 'unpdf';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TEXT_CHARS = 60_000;

export interface ExtractedFilePayload {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  extractedText: string;
  isBinaryMedia: boolean; // PDF or Image suitable for native multimodal input
}

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json'
};

export function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isTextLikeMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json';
}

export async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  try {
    const result = await extractText(new Uint8Array(buf), { mergePages: true });
    const rawText: string | string[] = result.text;
    const raw = Array.isArray(rawText) ? rawText.join('\n') : String(rawText || '');
    return raw.replace(/\u0000/g, '').trim().slice(0, MAX_TEXT_CHARS);
  } catch {
    // Scanned, encrypted, or malformed PDF — caller still gets base64 bytes for multimodal LLMs
    return '';
  }
}

export async function extractFileContent(filePath: string): Promise<ExtractedFilePayload> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.basename(filePath)}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a readable file: ${path.basename(filePath)}`);
  }
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `${path.basename(filePath)} is ${(stat.size / (1024 * 1024)).toFixed(1)} MB (max 15 MB per file).`
    );
  }

  const fileName = path.basename(filePath);
  const mimeType = detectMimeType(filePath);
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');

  let extractedText = '';
  let isBinaryMedia = false;

  if (mimeType === 'application/pdf') {
    isBinaryMedia = true;
    extractedText = await extractPdfTextFromBuffer(buf);
  } else if (isImageMime(mimeType)) {
    isBinaryMedia = true;
  } else if (isTextLikeMime(mimeType)) {
    extractedText = buf.toString('utf-8').slice(0, MAX_TEXT_CHARS);
  } else {
    // Best-effort UTF-8 preview for unknown extensions
    extractedText = buf.toString('utf-8').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, '').slice(0, 12_000);
  }

  return {
    filePath,
    fileName,
    mimeType,
    sizeBytes: stat.size,
    base64,
    extractedText,
    isBinaryMedia
  };
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return base.slice(0, 100) || 'document';
}

export function getVaultRoot(userDataDir: string): string {
  return path.join(userDataDir, 'vault');
}

/**
 * Copies an insurance policy or renewal document into the app's local vault so moving/deleting
 * the source file on the user's computer never breaks in-app viewing.
 */
export function copyInsuranceDocToVault(
  userDataDir: string,
  policyId: number,
  sourcePath: string
): { storedRelPath: string; fileName: string; mimeType: string; sizeBytes: number } {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source document not found: ${sourcePath}`);
  }
  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Document exceeds 15 MB limit (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`);
  }

  const fileName = path.basename(sourcePath);
  const mimeType = detectMimeType(sourcePath);
  const storedName = `${Date.now()}-${sanitizeFilename(fileName)}`;
  const relPath = path.join('insurance', `policy-${policyId}`, storedName);
  const absTarget = resolveVaultFilePath(userDataDir, relPath);

  fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  fs.copyFileSync(sourcePath, absTarget);

  return {
    storedRelPath: relPath,
    fileName,
    mimeType,
    sizeBytes: stat.size
  };
}

export function resolveVaultFilePath(userDataDir: string, storedRelPath: string): string {
  const root = path.resolve(getVaultRoot(userDataDir));
  const resolved = path.resolve(root, storedRelPath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid vault document path.');
  }
  return resolved;
}

export function readVaultFileBase64(userDataDir: string, storedRelPath: string): string {
  const absPath = resolveVaultFilePath(userDataDir, storedRelPath);
  if (!fs.existsSync(absPath)) {
    throw new Error('Stored document file could not be found in local vault.');
  }
  return fs.readFileSync(absPath).toString('base64');
}

export function deleteVaultFile(userDataDir: string, storedRelPath: string): void {
  try {
    const absPath = resolveVaultFilePath(userDataDir, storedRelPath);
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  } catch {
    // Ignore missing file on delete
  }
}

export function wipeVault(userDataDir: string): void {
  try {
    const root = getVaultRoot(userDataDir);
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup
  }
}
