import { AIProviderId, InsuranceCategory, InsurancePolicy } from '@shared/types';
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
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/Rs\.?|INR/gi, '').trim();
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

function findLabeledAmount(text: string, labelPattern: RegExp): number {
  const re = new RegExp(
    `(?:${labelPattern.source})[^\\n\\r\\d₹]{0,40}(?:(?:Rs\\.?|INR|₹)\\s*)?([\\d,]+(?:\\.\\d{1,2})?(?:\\s*(?:Cr|Crores?|Lakhs?|Lacs?|L))?)`,
    'i'
  );
  const m = text.match(re);
  if (!m?.[1]) return 0;
  return parseIndianCurrencyAmount(m[1]);
}

function detectCategory(text: string, fileName: string): InsuranceCategory {
  const combined = `${fileName}\n${text}`;
  if (/\b(ulip|unit[\s-]+linked|nav[\s-]+based\s+insurance)\b/i.test(combined)) return 'ULIP';
  if (
    /\b(health\s+insurance|mediclaim|family\s+floater|optima\s+secure|reassure|super\s+top[\s-]?up|hospitali[sz]ation|sum\s+insured|cashless\s+hospital)\b/i.test(
      combined
    )
  ) {
    return 'Health';
  }
  if (
    /\b(pure\s+term|term\s+(?:life|plan|assurance|insurance)|click\s*2\s*protect|iprotect\s+smart|smart\s+secure\s+plus|sampoorna\s+raksha)\b/i.test(
      combined
    )
  ) {
    return 'Term Life';
  }
  if (
    /\b(endowment|money[\s-]+back|guaranteed\s+(?:income|return|savings)|jeevan\s+(?:anand|umang|labh|lakshya|utsav)|sanchay\s+plus|participating\s+life|maturity\s+benefit)\b/i.test(
      combined
    )
  ) {
    return 'Endowment / Guaranteed';
  }
  if (/\b(motor\s+insurance|private\s+car|two[\s-]+wheeler|vehicle\s+insurance|own\s+damage|third[\s-]+party\s+liability|idv)\b/i.test(combined)) {
    return 'Vehicle / Other';
  }
  return 'Term Life';
}

/**
 * Deterministic, 100% offline heuristic parser for Indian insurance policy PDFs & renewal receipts.
 * Used automatically when no AI API key is configured, and as fallback/enrichment alongside AI parsing.
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
  const planMatch = normalized.match(
    /(?:Plan\s+Name|Product\s+Name|Policy\s+Name|Scheme\s+Name|Name\s+of\s+(?:the\s+)?Plan)\s*[:\-–]\s*([^\n]{3,90})/i
  );
  if (planMatch?.[1]) {
    planName = planMatch[1].replace(/\s{2,}/g, ' ').trim();
  } else if (fileName) {
    planName = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 70);
  }

  // Sum Assured / Sum Insured / Cover
  const sumAssured = findLabeledAmount(
    normalized,
    /Sum\s+Assured|Sum\s+Insured|Base\s+Sum\s+Insured|Life\s+Cover|Base\s+Cover|Death\s+Benefit|Total\s+Cover/i
  );

  // Annual Premium (prefer Total/Gross/Annual incl. GST)
  let annualPremium = findLabeledAmount(
    normalized,
    /Annual(?:ized)?\s+Premium|Total\s+Premium(?:\s+Payable)?|Gross\s+Premium|Net\s+Premium\s+Payable|Premium\s+Amount|Renewal\s+Premium/i
  );
  if (annualPremium > 0) {
    if (/\b(?:monthly\s+mode|payment\s+frequency\s*[:\-]\s*monthly|mode\s*[:\-]\s*monthly)\b/i.test(normalized)) {
      annualPremium = annualPremium * 12;
    } else if (/\b(?:half[\s-]?yearly|semi[\s-]?annual)\b/i.test(normalized) && !/annual(?:ized)?\s+premium/i.test(normalized)) {
      annualPremium = annualPremium * 2;
    } else if (/\bquarterly\b/i.test(normalized) && !/annual(?:ized)?\s+premium/i.test(normalized)) {
      annualPremium = annualPremium * 4;
    }
  }

  // Renewal Date / Expiry / Next Premium Due
  let renewalDate = '';
  const datePattern = '(\\d{1,2}[\\/-](?:\\d{1,2}|[A-Za-z]{3,9})[\\/-]\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4})';
  const renewalRe = new RegExp(
    `(?:Renewal\\s+Date|Next\\s+(?:Premium\\s+)?Due\\s+Date|Policy\\s+End\\s+Date|Policy\\s+Expiry\\s+Date|Valid\\s+(?:Till|Up\\s*to)|Period\\s+of\\s+Insurance[^\\n]{0,30}to)\\s*[:\\-–]?\\s*${datePattern}`,
    'i'
  );
  const renewalMatch = normalized.match(renewalRe);
  if (renewalMatch?.[1]) {
    renewalDate = renewalMatch[1].trim();
  }

  // Payment Term / Policy Term
  const termParts: string[] = [];
  const pptMatch = normalized.match(/Premium\s+Pay(?:ing|ment)\s+Term\s*[:\-–]?\s*([0-9]+\s*(?:Years?|Yrs?)|Regular\s+Pay|Single\s+Pay|Limited\s+Pay)/i);
  const ptMatch = normalized.match(/Policy\s+Term\s*[:\-–]?\s*([0-9]+\s*(?:Years?|Yrs?)|Whole\s+Life)/i);
  if (pptMatch?.[1]) termParts.push(`PPT ${pptMatch[1].trim()}`);
  if (ptMatch?.[1]) termParts.push(`Term ${ptMatch[1].trim()}`);
  const paymentTerm = termParts.join(' / ') || (category === 'Health' || category === 'Vehicle / Other' ? 'Annual' : '');

  // Policy Number -> Notes
  const notesParts: string[] = [];
  const policyNoMatch = normalized.match(/(?:Policy\s*(?:No\.?|Number)|Certificate\s*No\.?)\s*[:\-–#]?\s*([A-Z0-9\/-]{6,26})/i);
  if (policyNoMatch?.[1] && /\d/.test(policyNoMatch[1])) {
    notesParts.push(`Policy No: ${policyNoMatch[1].trim()}`);
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

  if (canUseAi && ai) {
    try {
      const completion = await runLLMCompletion({
        provider: ai.provider,
        model: ai.model,
        apiKey: ai.apiKey,
        baseUrl: ai.baseUrl || undefined,
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
                base64: input.extracted.isBinaryMedia ? input.extracted.base64 : undefined,
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
    } catch {
      // Fall through cleanly to local heuristic parser if AI request fails
    }
  }

  const isScannedOrImage = !input.extracted.extractedText || input.extracted.extractedText.trim().length < 40;
  return {
    parsedBy: 'local_heuristic',
    fields: heuristic,
    notice: isScannedOrImage
      ? 'This file appears to be an image or scanned PDF with limited selectable text. Configure an AI key in Settings for automatic OCR extraction, or fill in the fields below — your document will still be saved and viewable in the app!'
      : undefined
  };
}
