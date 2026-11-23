import { AIProviderId, InsuranceCategory, InsurancePolicy, LocalCliToolId } from '@shared/types';
import { AI_PROVIDER_PRESETS } from '@shared/constants';
import { buildInsuranceExtractionPrompt } from '@main/ai/promptBuilder';
import { runLLMCompletion } from '@main/ai/providers';
import { ExtractedFilePayload } from './documentVault';

const VALID_CATEGORIES = new Set<InsuranceCategory>([
  'Term Life',
  'Health',
  'Endowment / Guaranteed',
  'ULIP',
  'Vehicle / Other'
]);

const KNOWN_INSURERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bhdfc\s+ergo\b/i, name: 'HDFC Ergo' },
  { pattern: /\bhdfc\s+life\b|\bhdfc\s+standard\s+life\b/i, name: 'HDFC Life' },
  { pattern: /\bicici\s+prudential\b|\bicici\s+pru\b/i, name: 'ICICI Prudential' },
  { pattern: /\bicici\s+lombard\b/i, name: 'ICICI Lombard' },
  { pattern: /\bniva\s+bupa\b|\bmax\s+bupa\b/i, name: 'Niva Bupa' },
  { pattern: /\bstar\s+health\b/i, name: 'Star Health' },
  { pattern: /\bcare\s+health\b|\breligare\s+health\b/i, name: 'Care Health' },
  { pattern: /\baditya\s+birla\s+health\b/i, name: 'Aditya Birla Health' },
  { pattern: /\baditya\s+birla\s+sun\s+life\b/i, name: 'Aditya Birla Sun Life' },
  { pattern: /\baxis\s+max\s+life\b|\bmax\s+life\b/i, name: 'Axis Max Life' },
  { pattern: /\bsbi\s+life\b/i, name: 'SBI Life' },
  { pattern: /\bsbi\s+general\b/i, name: 'SBI General' },
  { pattern: /\btata\s+aia\b/i, name: 'Tata AIA' },
  { pattern: /\btata\s+aig\b/i, name: 'Tata AIG' },
  { pattern: /\bbajaj\s+allianz\b/i, name: 'Bajaj Allianz' },
  { pattern: /\bkotak\s+(?:mahindra\s+)?life\b/i, name: 'Kotak Life' },
  { pattern: /\bmanipal\s*cigna\b/i, name: 'ManipalCigna' },
  { pattern: /\backo\b/i, name: 'Acko' },
  { pattern: /\bgo\s*digit\b|\bdigit\s+general\b/i, name: 'Digit Insurance' },
  { pattern: /\bpnb\s+metlife\b/i, name: 'PNB MetLife' },
  { pattern: /\bcanara\s+hsbc\b/i, name: 'Canara HSBC Life' },
  { pattern: /\bnew\s+india\s+assurance\b/i, name: 'New India Assurance' },
  { pattern: /\boriental\s+insurance\b/i, name: 'Oriental Insurance' },
  { pattern: /\bunited\s+india\s+insurance\b/i, name: 'United India Insurance' },
  { pattern: /\bnational\s+insurance\b/i, name: 'National Insurance' },
  { pattern: /\blife\s+insurance\s+corporation\b|\blic\s+of\s+india\b|\blic\b/i, name: 'LIC' }
];

function parseIndianCurrencyAmount(raw: string): number {
  // Indian insurer PDFs (e.g. HDFC Life) often encode ₹ as backtick (`) in Rupee_Foradian font
  const cleaned = raw.replace(/[₹`,\s]/g, '').replace(/Rs\.?|INR/gi, '').trim();
  const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)(cr|crore|crores|l|lac|lacs|lakh|lakhs|k)?$/i);
  if (!numMatch) return 0;
  const val = Number(numMatch[1]);
  if (!Number.isFinite(val) || val <= 0) return 0;
  const unit = (numMatch[2] || '').toLowerCase();
  if (unit === 'cr' || unit === 'crore' || unit === 'crores') return Math.round(val * 10_000_000);
  if (unit === 'l' || unit === 'lac' || unit === 'lacs' || unit === 'lakh' || unit === 'lakhs') {
    return Math.round(val * 100_000);
  }
  if (unit === 'k') return Math.round(val * 1_000);
  return Math.round(val);
}

/**
 * Finds the first valid currency amount (>= minAmount) following a label using global matching,
 * skipping clause/section numbers (e.g. "Clause 1", "0.00") and supporting multi-line labels
 * plus Rupee_Foradian backtick (`) currency symbols (HDFC Life).
 */
function findLabeledAmount(
  text: string,
  labelPattern: RegExp,
  options?: { allowMultiline?: boolean; minAmount?: number }
): number {
  const allowMultiline = options?.allowMultiline ?? true;
  const minAmount = options?.minAmount ?? 500;
  const gap = allowMultiline ? '[^\\d₹`]{0,120}' : '[^\\n\\r\\d₹`]{0,60}';
  const re = new RegExp(
    `(?:${labelPattern.source})${gap}(?:(?:Rs\\.?|INR|₹|\`)\\s*)?([\\d,]+(?:\\.\\d{1,2})?(?:\\s*(?:Cr|Crores?|Lakhs?|Lacs?|L))?)`,
    'gi'
  );
  for (const m of text.matchAll(re)) {
    if (!m[1]) continue;
    const amt = parseIndianCurrencyAmount(m[1]);
    if (amt >= minAmount) return amt;
  }
  return 0;
}

function detectCategory(text: string, fileName: string): InsuranceCategory {
  const combined = `${fileName}\n${text.slice(0, 12000)}`;
  if (/\b(ulip|unit[\s-]+linked|nav[\s-]+based\s+insurance)\b/i.test(combined)) return 'ULIP';
  if (
    /\b(health\s+insurance|mediclaim|family\s+floater|optima\s+secure|reassure|super\s+top[\s-]?up|hospitali[sz]ation|sum\s+insured|cashless\s+hospital)\b/i.test(
      combined
    )
  ) {
    return 'Health';
  }
  if (
    /\b(endowment|money[\s-]+back|guaranteed\s+(?:income|return|savings|maturity)|non[\s-]+linked\s+savings\s+life|jeevan\s+(?:anand|umang|labh|lakshya|utsav)|sanchay\s+plus|participating\s+life)\b/i.test(
      combined
    )
  ) {
    return 'Endowment / Guaranteed';
  }
  if (
    /\b(pure\s+term|pure\s+risk\s+life|term\s+(?:life|plan|assurance|insurance)|smart\s+term\s+plan|click\s*2\s*protect|iprotect\s+smart|smart\s+secure\s+plus|sampoorna\s+raksha)\b/i.test(
      combined
    )
  ) {
    return 'Term Life';
  }
  if (
    /\b(motor\s+insurance|private\s+car|two[\s-]+wheeler|vehicle\s+insurance|own\s+damage|third[\s-]+party\s+liability|idv)\b/i.test(
      combined
    )
  ) {
    return 'Vehicle / Other';
  }
  return 'Term Life';
}

function cleanPlanName(raw: string): string {
  return raw
    .replace(/[,|]\s*Product\s+UIN.*$/i, '')
    .replace(/\s+Type\s+of\s+Policy\s*:.*$/i, '')
    .replace(/\s+UIN\s*[:\-].*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80);
}

function parseMonthYearSpanYears(startStr: string, endStr: string): number {
  const s = Date.parse(startStr.replace(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/, '$1 $2 $3'));
  const e = Date.parse(endStr.replace(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/, '$1 $2 $3'));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 1;
  const years = Math.round((e - s) / (365.25 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(10, years));
}

/**
 * Deterministic, 100% offline heuristic parser for Indian insurance policy PDFs & renewal receipts.
 * Handles real Indian insurer formats (Axis Max Life, HDFC Life, Niva Bupa, HDFC Ergo, LIC, ICICI, Star Health).
 */
export function parseInsuranceTextHeuristics(
  text: string,
  fileName = ''
): Partial<Omit<InsurancePolicy, 'id' | 'documents'>> {
  const normalized = (text || '').replace(/\r\n/g, '\n');
  const combined = `${fileName}\n${normalized}`;

  let insurer = '';
  for (const cand of KNOWN_INSURERS) {
    if (cand.pattern.test(combined)) {
      insurer = cand.name;
      break;
    }
  }

  const category = detectCategory(normalized, fileName);

  // Plan Name
  let planName = '';
  const planPatterns = [
    /(?:Plan\s+Name|Product\s+Name|Policy\s+Name|Scheme\s+Name|Name\s+of\s+(?:the\s+)?Plan)\s*[:\-–]\s*([^\n]{3,110})/i,
    /POLICY\s+DOCUMENT\s*[-–:]\s*([^\n]{3,90})/i,
    /\bPolicy\s*:\s*([^\n]{4,110})/i
  ];
  for (const re of planPatterns) {
    const m = normalized.match(re);
    if (m?.[1]) {
      const candidate = cleanPlanName(m[1]);
      if (candidate.length >= 3) {
        planName = candidate;
        break;
      }
    }
  }
  if (!planName && fileName) {
    planName = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 70);
  }

  // Prioritize the front Policy Schedule / Premium Receipt window (first ~12,000 chars) so boilerplate T&C examples never shadow real schedule figures!
  const scheduleSlice = normalized.slice(0, 12_500);

  // Sum Assured / Sum Insured (handle "Unlimited" Base Sum Insured cleanly!)
  const hasUnlimitedCover = /\b(?:Base\s+)?Sum\s+Insured(?:\s*\(INR\))?\s*[:\-–]?\s*Unlimited\b/i.test(scheduleSlice);
  let sumAssured = 0;
  if (!hasUnlimitedCover) {
    const sumRe =
      /Base\s+Sum\s+Assured|Sum\s+Assured\s+on\s+Death|Base\s+Sum\s+Insured|Sum\s+Assured|Sum\s+Insured|Life\s+Cover|Base\s+Cover|Death\s+Benefit|Total\s+Cover/i;
    const findStackedSum = (src: string): number => {
      for (const m of src.matchAll(/Sum\s+Assured[\s\S]{0,260}?(?:₹|`|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
        const amt = parseIndianCurrencyAmount(m[1]);
        if (amt >= 25_000) return amt;
      }
      return 0;
    };
    sumAssured =
      findLabeledAmount(scheduleSlice, sumRe, { allowMultiline: true, minAmount: 25_000 }) ||
      findStackedSum(scheduleSlice) ||
      findLabeledAmount(normalized, sumRe, { allowMultiline: true, minAmount: 25_000 }) ||
      findStackedSum(normalized);
  }

  // Annual Premium (handle British "Annualised" + American "Annualized", HDFC Life Rupee backtick "`", and Gross/Total Premium)
  const primaryPremRe =
    /Annuali[sz]ed\s+Premium|Annual\s+Premium|Premium\s+per\s+Frequency\s+of\s+Premium\s+Payment|Total\s+Premium\s+per\s+Frequency\s+of\s+Premium\s+Payment/i;
  const secondaryPremRe =
    /Gross\s+Premium(?:\s*\(INR\))?|Net\s+Premium\s*(?:\/\s*Taxable\s+Value)?(?:\s*\((?:Rs\.?|INR)\))?|Total\s+Premium(?:\s*\([^)]+\))?(?:\s+along\s+with[^:\n]{0,70})?(?:\s+payable)?|Renewal\s+Premium|Premium\s+Amount/i;

  let annualPremium =
    findLabeledAmount(scheduleSlice, primaryPremRe, { allowMultiline: false, minAmount: 500 }) ||
    findLabeledAmount(scheduleSlice, secondaryPremRe, { allowMultiline: true, minAmount: 500 }) ||
    findLabeledAmount(normalized, primaryPremRe, { allowMultiline: false, minAmount: 500 }) ||
    findLabeledAmount(normalized, secondaryPremRe, { allowMultiline: true, minAmount: 500 });

  // Stacked table fallback for "Annualized Premium ... ` 500,000.00" or "Gross Premium ... 67,731"
  if (annualPremium === 0) {
    for (const m of normalized.matchAll(
      /(?:Annuali[sz]ed\s+Premium|Gross\s+Premium|Total\s+Premium)[\s\S]{0,220}?(?:(?:₹|`|Rs\.?)\s*)?([\d,]{4,}(?:\.\d{1,2})?)/gi
    )) {
      const amt = parseIndianCurrencyAmount(m[1]);
      if (amt >= 500) {
        annualPremium = amt;
        break;
      }
    }
  }

  // Multi-year health policy span detection (e.g. Niva Bupa 25-MAY-2026 to 24-MAY-2029 = 3 years)
  const commMatch = normalized.match(
    /(?:Policy\s+Commencement\s+Date|Date\s+of\s+Commencement(?:\s+of\s+Risk)?)[#\s:\-–]*(\d{1,2}[\/-][A-Za-z]{3,9}[\/-]\d{4})/i
  );
  const expMatch = normalized.match(
    /(?:Policy\s+Expiry\s+Date|Policy\s+End\s+Date)[#\s:\-–]*(\d{1,2}[\/-][A-Za-z]{3,9}[\/-]\d{4})/i
  );
  const multiYearSpan = commMatch?.[1] && expMatch?.[1] ? parseMonthYearSpanYears(commMatch[1], expMatch[1]) : 1;

  const isExplicitlyAnnual =
    /\b(?:Frequency\s+of\s+Premium\s+Payment|Premium\s+Payment\s+Mode)[\s:\-–\n]{1,12}Annual\b/i.test(normalized) ||
    /\bAnnuali[sz]ed?\s+Premium[\s:\-–]{1,12}(?:₹|`|Rs\.?)?\s*[\d,]{4,}/i.test(normalized);

  let multiYearNote = '';
  if (category === 'Health' && multiYearSpan >= 2 && annualPremium > 0 && !isExplicitlyAnnual) {
    multiYearNote = `${multiYearSpan}-Yr Plan (Total Paid ₹${annualPremium.toLocaleString('en-IN')})`;
    annualPremium = Math.round(annualPremium / multiYearSpan);
  } else if (annualPremium > 0 && !isExplicitlyAnnual) {
    if (/\b(?:payment\s+frequency|premium\s+payment\s+mode|mode\s+of\s+payment)\s*[:\-–]\s*monthly\b/i.test(normalized)) {
      annualPremium = annualPremium * 12;
    } else if (/\b(?:payment\s+frequency|premium\s+payment\s+mode|mode\s+of\s+payment)\s*[:\-–]\s*(?:half[\s-]?yearly|semi[\s-]?annual)\b/i.test(normalized)) {
      annualPremium = annualPremium * 2;
    } else if (/\b(?:payment\s+frequency|premium\s+payment\s+mode|mode\s+of\s+payment)\s*[:\-–]\s*quarterly\b/i.test(normalized)) {
      annualPremium = annualPremium * 4;
    }
  }

  // Renewal Date / Expiry / Next Premium Due (handles DD-MMM-YYYY, DD/MM/YYYY, "4th May", "15th of May every year")
  let renewalDate = '';
  const stdDate = '(\\d{1,2}[\\/-](?:\\d{1,2}|[A-Za-z]{3,9})[\\/-]\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4})';
  const ordinalDate = '(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\\s+\\d{4})?)';

  const renewalRegexes = [
    new RegExp(
      `(?:Policy\\s+Expiry\\s+Date|Policy\\s+End\\s+Date|Renewal\\s+Date|Next\\s+(?:Premium\\s+)?Due\\s+Date|Valid\\s+(?:Till|Up\\s*to)|Period\\s+of\\s+Insurance[^\\n]{0,30}to)[#\\s:\\-–]*${stdDate}`,
      'i'
    ),
    new RegExp(
      `(?:Due\\s+Date\\s+when\\s+Premium\\s+is\\s+payable|Premium\\s+Due\\s+Date\\(?s?\\)?)[\\s:\\-–\\n]{0,20}${ordinalDate}`,
      'i'
    )
  ];
  for (const re of renewalRegexes) {
    const m = normalized.match(re);
    if (m?.[1]) {
      renewalDate = m[1].replace(/\s+of\s+/i, ' ').trim();
      break;
    }
  }

  // Payment Term / Policy Term (handles "Premium Payment Term (in years)\n10", "Policy Term (in years) 26", "Premium Paying Term 9 years")
  const termParts: string[] = [];
  const pptMatch = normalized.match(
    /Premium\s+Pay(?:ing|ment)\s+Term(?:\s*\(in\s+years?\))?[\s:\-–\n]{1,12}([0-9]+(?:\s*(?:Years?|Yrs?))?|Regular\s+Pay|Single\s+Pay|Limited\s+Pay)/i
  );
  const ptMatch = normalized.match(
    /Policy\s+Term(?:\s*\(in\s+years?\))?[\s:\-–\n]{1,12}([0-9]+(?:\s*(?:Years?|Yrs?))?|Whole\s+Life)/i
  );
  if (pptMatch?.[1]) {
    const rawPpt = pptMatch[1].trim();
    termParts.push(`PPT ${/^\d+$/.test(rawPpt) ? `${rawPpt} Yrs` : rawPpt}`);
  }
  if (ptMatch?.[1]) {
    const rawPt = ptMatch[1].trim();
    termParts.push(`Term ${/^\d+$/.test(rawPt) ? `${rawPt} Yrs` : rawPt}`);
  }
  const paymentTerm =
    (category === 'Health' && multiYearSpan >= 2 ? `${multiYearSpan} Years` : '') ||
    termParts.join(' / ') ||
    (category === 'Health' || category === 'Vehicle / Other' ? 'Annual' : '');

  // Notes: Policy Number + Unlimited cover + Maturity Date + Multi-year info
  const notesParts: string[] = [];
  for (const m of normalized.matchAll(
    /(?:Policy\s*(?:No\.?|Number)|Certificate\s*No\.?)[\s:\-–#\n]{1,14}([A-Z0-9\/-]{6,26})/gi
  )) {
    if (m[1] && /\d{4,}/.test(m[1])) {
      notesParts.push(`Policy No: ${m[1].trim()}`);
      break;
    }
  }
  if (hasUnlimitedCover) {
    notesParts.push('Unlimited Base Sum Insured');
  }
  if (multiYearNote) {
    notesParts.push(multiYearNote);
  }
  const matMatch = normalized.match(/Maturity\s+Date[\s:\-–]{1,10}(\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3,9})[\/-]\d{2,4})/i);
  if (matMatch?.[1]) {
    notesParts.push(`Maturity: ${matMatch[1].trim()}`);
  }

  return {
    category,
    insurer,
    planName,
    sumAssured,
    annualPremium,
    renewalDate,
    paymentTerm,
    notes: notesParts.join(' · ')
  };
}

function parseJsonFromLlmText(rawText: string): Record<string, unknown> | null {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function parseInsuranceDocument(input: {
  extracted: ExtractedFilePayload;
  docType: 'policy' | 'renewal';
  ai?: {
    provider: AIProviderId;
    model: string;
    apiKey: string | null;
    baseUrl?: string;
    cliTool?: LocalCliToolId;
    cliBinaryPath?: string;
  };
}): Promise<{
  parsedBy: 'ai' | 'local_heuristic';
  fields: Partial<Omit<InsurancePolicy, 'id' | 'documents'>>;
  notice?: string;
}> {
  const heuristic = parseInsuranceTextHeuristics(input.extracted.extractedText, input.extracted.fileName);

  const ai = input.ai;
  const preset = ai ? AI_PROVIDER_PRESETS[ai.provider] : null;
  const canUseAi = Boolean(ai && preset && (!preset.requiresKey || (ai.apiKey && ai.apiKey.trim().length > 0)));
  let aiFallbackReason: string | undefined;

  if (canUseAi && ai) {
    try {
      const completion = await runLLMCompletion({
        provider: ai.provider,
        model: ai.model,
        apiKey: ai.apiKey,
        baseUrl: ai.baseUrl || undefined,
        cliTool: ai.cliTool,
        cliBinaryPath: ai.cliBinaryPath || undefined,
        systemPrompt:
          'You extract structured Indian insurance policy data accurately and return ONLY raw JSON with zero markdown formatting.',
        maxTokens: 900,
        messages: [
          {
            role: 'user',
            content: buildInsuranceExtractionPrompt(input.extracted.fileName, input.docType),
            attachments: [
              {
                fileName: input.extracted.fileName,
                mimeType: input.extracted.mimeType,
                // For large 35–100p text-selectable PDFs, send focused extracted schedule pages instead of blowing LLM token limits!
                base64: input.extracted.shouldAttachBinaryToLLM ? input.extracted.base64 : undefined,
                extractedText: input.extracted.extractedText
              }
            ]
          }
        ]
      });

      const parsed = parseJsonFromLlmText(completion.text);
      if (parsed) {
        const rawCat = typeof parsed.category === 'string' ? (parsed.category.trim() as InsuranceCategory) : undefined;
        const category = rawCat && VALID_CATEGORIES.has(rawCat) ? rawCat : heuristic.category || 'Term Life';
        const sumNum = Number(parsed.sumAssured);
        const premNum = Number(parsed.annualPremium);

        return {
          parsedBy: 'ai',
          fields: {
            category,
            insurer: (typeof parsed.insurer === 'string' && parsed.insurer.trim()) || heuristic.insurer || '',
            planName: (typeof parsed.planName === 'string' && parsed.planName.trim()) || heuristic.planName || '',
            sumAssured: Number.isFinite(sumNum) && sumNum > 0 ? Math.round(sumNum) : heuristic.sumAssured || 0,
            annualPremium: Number.isFinite(premNum) && premNum > 0 ? Math.round(premNum) : heuristic.annualPremium || 0,
            renewalDate:
              (typeof parsed.renewalDate === 'string' && parsed.renewalDate.trim()) || heuristic.renewalDate || '',
            paymentTerm:
              (typeof parsed.paymentTerm === 'string' && parsed.paymentTerm.trim()) || heuristic.paymentTerm || '',
            notes: (typeof parsed.notes === 'string' && parsed.notes.trim()) || heuristic.notes || ''
          }
        };
      }
      aiFallbackReason = 'AI response could not be parsed as JSON';
    } catch (err) {
      aiFallbackReason = err instanceof Error ? err.message.slice(0, 120) : 'AI request failed';
    }
  }

  const isScannedOrImage = !input.extracted.extractedText || input.extracted.extractedText.trim().length < 40;
  let notice: string | undefined;
  if (isScannedOrImage) {
    notice =
      'This file appears to be an image or scanned PDF with limited selectable text. Configure an AI key in Settings for automatic OCR extraction, or enter details manually — your document will still be vaulted!';
  } else if (aiFallbackReason) {
    notice = `Filled with offline parser (AI step skipped: ${aiFallbackReason}). Review values below before saving.`;
  }

  return {
    parsedBy: 'local_heuristic',
    fields: heuristic,
    notice
  };
}
