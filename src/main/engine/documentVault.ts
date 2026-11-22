import fs from 'fs';
import path from 'path';
import { extractText } from 'unpdf';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TEXT_CHARS = 60_000;
const MAX_FOCUSED_PDF_CHARS = 24_000;
const MAX_INLINE_PDF_PAGES = 8;
const MAX_INLINE_PDF_BYTES = 1.5 * 1024 * 1024;

export interface ExtractedFilePayload {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  base64: string;
  extractedText: string;
  isBinaryMedia: boolean; // PDF or Image
  shouldAttachBinaryToLLM: boolean; // True for images, scanned PDFs, or short PDFs; false for 35–100p text-selectable PDFs so LLMs get focused pages cleanly
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

const HIGH_SIGNAL_PAGE_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\bpolicy\s+schedule\b/i, weight: 8 },
  { re: /\bcertificate\s+of\s+insurance\b|\binsurance\s+certificate\b/i, weight: 8 },
  { re: /\bcustomer\s+information\s+sheet\b/i, weight: 7 },
  { re: /\bpremium\s+receipt\b|\bpayment\s+receipt\b|\backnowledge\s+the\s+receipt\b/i, weight: 7 },
  { re: /\bbenefit\s+illustration\b|\bsummary\s+of\s+benefits\b/i, weight: 6 },
  { re: /\bsum\s+assured\b|\bsum\s+insured\b/i, weight: 5 },
  { re: /\bannuali[sz]ed?\s+premium\b|\bgross\s+premium\b|\btotal\s+premium\b|\bpremium\s+details\b/i, weight: 5 },
  { re: /\bpolicy\s+expiry\s+date\b|\bmaturity\s+date\b|\bpremium\s+due\s+date\b|\brenewal\s+date\b/i, weight: 4 },
  { re: /\bpremium\s+pay(?:ing|ment)\s+term\b|\bpolicy\s+term\b/i, weight: 4 },
  { re: /\bexpense\s+ratio\b|\bexit\s+load\b|\bsurrender\s+value\b|\birr\b/i, weight: 3 }
];

const BOILERPLATE_PENALTY_RE = /\b(part\s+[b-g]\b.*definitions|general\s+terms\s+(&|and)\s+conditions|standard\s+exclusions|grievance\s+redressal|ombudsman\s+office)\b/i;

/**
 * Selects the highest-signal pages from multi-page PDFs (e.g. 35–100 page Indian insurance policy kits)
 * so Policy Schedule, Premium Receipt, and Customer Information Sheet pages are always captured
 * without overflowing LLM token limits on 80 pages of boilerplate legal T&Cs.
 */
export function buildFocusedPdfText(pages: string[], maxChars = MAX_FOCUSED_PDF_CHARS): string {
  const cleanedPages = pages.map((p) => (p || '').replace(/\u0000/g, '').trim());
  const totalLen = cleanedPages.reduce((sum, p) => sum + p.length, 0);

  if (cleanedPages.length <= 8 && totalLen <= maxChars) {
    return cleanedPages
      .map((text, i) => (text ? `--- Page ${i + 1} ---\n${text}` : ''))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, maxChars);
  }

  const scored = cleanedPages.map((text, idx) => {
    let score = idx < 8 ? 14 - idx : 0; // Strong bias toward front Policy Schedule / Premium Receipt pages (Pages 1–8)
    for (const { re, weight } of HIGH_SIGNAL_PAGE_PATTERNS) {
      if (re.test(text)) score += weight;
    }
    if (BOILERPLATE_PENALTY_RE.test(text.slice(0, 700))) {
      score -= 10;
    }
    return { idx, text, score };
  });

  // Always include Pages 1–7 (cover letter + policy schedule + premium schedule + receipt) when within budget
  const selectedIndices = new Set<number>();
  let budget = 0;
  for (let i = 0; i < Math.min(7, cleanedPages.length); i += 1) {
    if (cleanedPages[i].length === 0) continue;
    if (i >= 4 && BOILERPLATE_PENALTY_RE.test(cleanedPages[i].slice(0, 700))) continue;
    if (budget + cleanedPages[i].length > maxChars && selectedIndices.size >= 4) break;
    selectedIndices.add(i);
    budget += cleanedPages[i].length + 28;
  }

  const ranked = [...scored]
    .filter((p) => p.text.length > 0 && !selectedIndices.has(p.idx) && p.score > 2)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  for (const item of ranked) {
    if (selectedIndices.size >= 11) break;
    if (budget + item.text.length > maxChars) continue;
    selectedIndices.add(item.idx);
    budget += item.text.length + 28;
  }

  const ordered = Array.from(selectedIndices).sort((a, b) => a - b);
  return ordered
    .map((i) => `--- Page ${i + 1} of ${cleanedPages.length} ---\n${cleanedPages[i]}`)
    .join('\n\n')
    .slice(0, maxChars);
}

export async function extractPdfPagesFromBuffer(buf: Buffer): Promise<{ pages: string[]; totalPages: number }> {
  try {
    const result = await extractText(new Uint8Array(buf), { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    return { pages, totalPages: result.totalPages || pages.length };
  } catch {
    return { pages: [], totalPages: 0 };
  }
}

export async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  const { pages } = await extractPdfPagesFromBuffer(buf);
  if (pages.length === 0) return '';
  return buildFocusedPdfText(pages, MAX_FOCUSED_PDF_CHARS);
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
  let pageCount: number | undefined;
  let isBinaryMedia = false;
  let shouldAttachBinaryToLLM = false;

  if (mimeType === 'application/pdf') {
    isBinaryMedia = true;
    const { pages, totalPages } = await extractPdfPagesFromBuffer(buf);
    pageCount = totalPages;
    extractedText = pages.length > 0 ? buildFocusedPdfText(pages, MAX_FOCUSED_PDF_CHARS) : '';
    const isScannedPdf = extractedText.trim().length < 250;
    const isShortPdf = totalPages > 0 && totalPages <= MAX_INLINE_PDF_PAGES && stat.size <= MAX_INLINE_PDF_BYTES;
    // Send raw PDF binary ONLY for scanned PDFs or short PDFs; for 35–100p text-selectable PDFs send focused schedule pages!
    shouldAttachBinaryToLLM = isScannedPdf || isShortPdf;
  } else if (isImageMime(mimeType)) {
    isBinaryMedia = true;
    shouldAttachBinaryToLLM = true;
  } else if (isTextLikeMime(mimeType)) {
    extractedText = buf.toString('utf-8').slice(0, MAX_TEXT_CHARS);
  } else {
    extractedText = buf.toString('utf-8').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, '').slice(0, 12_000);
  }

  return {
    filePath,
    fileName,
    mimeType,
    sizeBytes: stat.size,
    pageCount,
    base64,
    extractedText,
    isBinaryMedia,
    shouldAttachBinaryToLLM
  };
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return base.slice(0, 100) || 'document';
}

export function getVaultRoot(userDataDir: string): string {
  return path.join(userDataDir, 'vault');
}

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
