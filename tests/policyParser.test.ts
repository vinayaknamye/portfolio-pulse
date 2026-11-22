import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseInsuranceTextHeuristics } from '@main/engine/policyParser';
import {
  buildFocusedPdfText,
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

  it('handles multi-line Axis Max Life, Rupee-backtick HDFC Life, Unlimited Niva Bupa 3-year health, and focused PDF page selection', () => {
    const axisText = `
      POLICY SCHEDULE
      Policy: Axis Max Life Smart Term Plan Plus Type of Policy: Individual Pure Risk Life Insurance Plan
      Policy No.: 998877665
      Policy Term (in years) 26
      Premium Payment Term (in years)
      10
      Due Date when Premium is payable
      15th of May every year
      Maturity Date 15-May-2052
      Base Sum Assured (as chosen by Policyholder as on the Date of Commencement of Risk)
      1,00,00,000.00
      Annualised Premium 25,663.00
    `;
    const pAxis = parseInsuranceTextHeuristics(axisText);
    expect(pAxis.insurer).toBe('Axis Max Life');
    expect(pAxis.category).toBe('Term Life');
    expect(pAxis.planName).toBe('Axis Max Life Smart Term Plan Plus');
    expect(pAxis.sumAssured).toBe(10000000);
    expect(pAxis.annualPremium).toBe(25663);
    expect(pAxis.renewalDate).toBe('15th May');
    expect(pAxis.paymentTerm).toContain('PPT 10 Yrs');
    expect(pAxis.paymentTerm).toContain('Term 26 Yrs');
    expect(pAxis.notes).toContain('998877665');

    const hdfcSavingsText = `
      POLICY DOCUMENT- HDFC Life Sanchay Plus
      POLICY SCHEDULE
      Policy number: 30001122
      Plan Option Guaranteed Maturity
      Premium Due Date(s) 4th May
      Sum Assured
      Guaranteed Sum Assured on Maturity
      Sum Assured on Death
      Guaranteed Additions As mentioned in Part C Clause 1. (3)
      Annualized Premium
      \` 6,231,500.00
      \` 4,635,000.00
      \` 500,000.00
      Maturity Date 04/05/2041
      Premium per Frequency of Premium Payment \` 500,000.00
      Frequency of Premium Payment Annual
      Policy Term 15 years
      Premium Paying Term 9 years
    `;
    const pHdfc = parseInsuranceTextHeuristics(hdfcSavingsText);
    expect(pHdfc.insurer).toBe('HDFC Life');
    expect(pHdfc.category).toBe('Endowment / Guaranteed');
    expect(pHdfc.planName).toBe('HDFC Life Sanchay Plus');
    expect(pHdfc.sumAssured).toBe(6231500);
    expect(pHdfc.annualPremium).toBe(500000);
    expect(pHdfc.renewalDate).toBe('4th May');

    const nivaText = `
      Niva Bupa Health Insurance Co. Ltd.
      Product Name: ReAssure 3.0, Product UIN: NBHHLIP26047V012526
      Policy Number: 62001122334455
      Base Sum Insured Unlimited
      Policy Commencement Date# 25-MAY-2026
      Policy Expiry Date 24-MAY-2029
      Gross Premium 67,731
    `;
    const pNiva = parseInsuranceTextHeuristics(nivaText);
    expect(pNiva.insurer).toBe('Niva Bupa');
    expect(pNiva.category).toBe('Health');
    expect(pNiva.planName).toBe('ReAssure 3.0');
    expect(pNiva.sumAssured).toBe(0);
    expect(pNiva.annualPremium).toBe(22577);
    expect(pNiva.renewalDate).toBe('24-MAY-2029');
    expect(pNiva.paymentTerm).toBe('3 Years');
    expect(pNiva.notes).toContain('Unlimited Base Sum Insured');

    // Focused PDF extractor keeps schedule/receipt pages and skips 50 pages of Part B legal definitions
    const fakePages = Array.from({ length: 50 }, (_, i) =>
      i === 3
        ? 'POLICY SCHEDULE Sum Assured 1,00,00,000 Annualised Premium 25,000'
        : i === 6
        ? 'Premium Receipt Gross Premium 25,000 Policy Expiry Date 10-Aug-2027'
        : `PART B DEFINITIONS General Terms and Conditions Standard Exclusions boilerplate ${'x'.repeat(2000)}`
    );
    const focused = buildFocusedPdfText(fakePages, 12000);
    expect(focused).toContain('POLICY SCHEDULE');
    expect(focused).toContain('Premium Receipt');
    expect(focused.length).toBeLessThanOrEqual(12000);
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
