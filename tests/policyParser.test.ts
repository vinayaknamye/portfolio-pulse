import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseInsuranceTextHeuristics } from '@main/engine/policyParser';
import {
  copyInsuranceDocToVault,
  deleteVaultFile,
  extractPdfTextFromBuffer,
  readVaultFileBase64,
  resolveVaultFilePath,
  wipeVault
} from '@main/engine/documentVault';

describe('parseInsuranceTextHeuristics (Offline Indian Insurance Policy Parser)', () => {
  it('extracts Health policy insurer, plan, sum insured, annual premium, renewal date & policy number', () => {
    const sampleHealthText = `
      HDFC ERGO General Insurance Company Limited
      Policy Schedule - Health Insurance
      Policy Number: 2825204918273400001
      Plan Name: Optima Secure Family Floater
      Base Sum Insured: Rs. 15,00,000
      Total Premium Payable (Incl. GST): ₹32,450.00
      Period of Insurance: 11-Aug-2026 to 10-Aug-2027
      Policy Term: 1 Year
    `;
    const parsed = parseInsuranceTextHeuristics(sampleHealthText, 'hdfc-ergo-health.pdf');
    expect(parsed.insurer).toBe('HDFC Ergo');
    expect(parsed.category).toBe('Health');
    expect(parsed.planName).toBe('Optima Secure Family Floater');
    expect(parsed.sumAssured).toBe(1500000);
    expect(parsed.annualPremium).toBe(32450);
    expect(parsed.renewalDate).toBe('10-Aug-2027');
    expect(parsed.notes).toContain('2825204918273400001');
  });

  it('extracts Term Life cover in Crores, PPT/Term, and annual premium', () => {
    const sampleTermText = `
      HDFC Life Insurance Company Limited
      Product Name: Click 2 Protect Super (Pure Term Plan)
      Policy No: 24981122
      Life Cover: 2 Crore
      Annualized Premium: ₹24,800
      Premium Paying Term: 15 Years
      Policy Term: 30 Years
      Next Premium Due Date: 15-Mar-2027
    `;
    const parsed = parseInsuranceTextHeuristics(sampleTermText, 'term-policy.pdf');
    expect(parsed.insurer).toBe('HDFC Life');
    expect(parsed.category).toBe('Term Life');
    expect(parsed.sumAssured).toBe(20000000);
    expect(parsed.annualPremium).toBe(24800);
    expect(parsed.renewalDate).toBe('15-Mar-2027');
    expect(parsed.paymentTerm).toContain('15 Years');
    expect(parsed.paymentTerm).toContain('30 Years');
  });

  it('classifies LIC Endowment and ULIP policies and annualizes monthly premium mode', () => {
    const licEndowment = `
      Life Insurance Corporation of India
      Plan Name: LIC New Jeevan Anand Endowment Plan
      Sum Assured: 10 Lakhs
      Payment Frequency: Monthly
      Premium Amount: Rs. 3,500
    `;
    const parsedLic = parseInsuranceTextHeuristics(licEndowment);
    expect(parsedLic.insurer).toBe('LIC');
    expect(parsedLic.category).toBe('Endowment / Guaranteed');
    expect(parsedLic.sumAssured).toBe(1000000);
    expect(parsedLic.annualPremium).toBe(42000);

    const ulipText = `ICICI Prudential Life Insurance — Signature Unit Linked Plan (ULIP)\nAnnual Premium: ₹2,00,000`;
    const parsedUlip = parseInsuranceTextHeuristics(ulipText);
    expect(parsedUlip.insurer).toBe('ICICI Prudential');
    expect(parsedUlip.category).toBe('ULIP');
    expect(parsedUlip.annualPremium).toBe(200000);
  });
});

describe('documentVault (Local Insurance Document Vault)', () => {
  it('copies, reads base64, rejects path traversal, deletes individual files, and wipes cleanly', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-vault-test-'));
    const sampleSrc = path.join(tmpRoot, 'policy-schedule.txt');
    fs.writeFileSync(sampleSrc, 'Sample HDFC Policy Schedule', 'utf-8');

    const userData = path.join(tmpRoot, 'userdata');
    const stored = copyInsuranceDocToVault(userData, 7, sampleSrc);
    expect(stored.fileName).toBe('policy-schedule.txt');
    expect(stored.mimeType).toBe('text/plain');
    expect(stored.storedRelPath).toContain('policy-7');

    const b64 = readVaultFileBase64(userData, stored.storedRelPath);
    expect(Buffer.from(b64, 'base64').toString('utf-8')).toBe('Sample HDFC Policy Schedule');

    // Path traversal guard
    expect(() => resolveVaultFilePath(userData, '../../etc/passwd')).toThrow(/Invalid vault document path/i);

    deleteVaultFile(userData, stored.storedRelPath);
    expect(() => readVaultFileBase64(userData, stored.storedRelPath)).toThrow(/could not be found/i);

    wipeVault(userData);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('extracts selectable text from a PDF buffer via unpdf and fails safely on malformed bytes', async () => {
    // Minimal valid single-page PDF containing "HDFC Ergo Optima Secure"
    const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT /F1 12 Tf 20 80 Td (HDFC Ergo Optima Secure) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000346 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
416
%%EOF`;

    const extracted = await extractPdfTextFromBuffer(Buffer.from(minimalPdf, 'utf-8'));
    expect(extracted).toContain('HDFC Ergo Optima Secure');

    const bad = await extractPdfTextFromBuffer(Buffer.from('not a pdf', 'utf-8'));
    expect(bad).toBe('');
  });
});
