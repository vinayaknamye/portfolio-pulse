import { AdvisorTopic, AuditAlert, InsurancePolicy, PortfolioSnapshot, UserProfile } from '@shared/types';
import { NON_ADVISORY_DISCLAIMER } from '@shared/constants';

function formatLakh(val: number): string {
  return `₹${(val / 100000).toFixed(2)}L`;
}

function isInternalCode(sym: string): boolean {
  return !sym || /^INDS\d+$/i.test(sym) || /^DEMO_[A-Z0-9]+$/i.test(sym) || /^[A-Z]{2}[A-Z0-9]{10}$/i.test(sym);
}

export function buildPortfolioContextBlock(
  snapshot: PortfolioSnapshot,
  previous: PortfolioSnapshot | null,
  alerts: AuditAlert[],
  profile: UserProfile,
  insurancePolicies: InsurancePolicy[] = []
): string {
  const deltaLine =
    previous && previous.totalNetworth > 0
      ? `Change vs ${previous.snapshotDate}: ${snapshot.totalNetworth - previous.totalNetworth >= 0 ? '+' : ''}₹${Math.round(snapshot.totalNetworth - previous.totalNetworth).toLocaleString('en-IN')} (${(((snapshot.totalNetworth - previous.totalNetworth) / previous.totalNetworth) * 100).toFixed(2)}%)`
      : 'First recorded snapshot (no prior delta yet).';

  const allocRows = snapshot.allocations
    .map(
      (a) =>
        `- ${a.assetType}: Current ${formatLakh(a.currentValue)} (${a.weightPct.toFixed(1)}%), Invested ${formatLakh(a.investedValue)}, Return ${a.returnPct >= 0 ? '+' : ''}${a.returnPct.toFixed(1)}%`
    )
    .join('\n');

  const topEquities = snapshot.equities
    .filter((e) => !e.isNonEquity)
    .slice(0, 25)
    .map((e) => {
      const label = !isInternalCode(e.symbol) ? `${e.name} (${e.symbol})` : e.name;
      const pnlStr = e.costBasisSource === 'market_value_proxy' ? 'cost basis N/A' : `${e.pnlPct >= 0 ? '+' : ''}${e.pnlPct.toFixed(1)}%`;
      const partialNote = e.partialCostBasisNote ? ` [Note: ${e.partialCostBasisNote}]` : '';
      return `- ${label} [${e.broker}]: ${formatLakh(e.currentValue)} | Qty ${e.quantity} | ${pnlStr}${partialNote}`;
    })
    .join('\n');

  const bonds = snapshot.bonds || [];
  const bondRows =
    bonds.length > 0
      ? bonds
          .map((b) => {
            const pnlStr =
              b.costBasisSource === 'market_value_proxy'
                ? 'cost basis N/A'
                : `${b.pnlPct >= 0 ? '+' : ''}${b.pnlPct.toFixed(1)}%`;
            return `- ${b.name} [${b.bondType} · ${b.broker}]: ${formatLakh(b.currentValue)} | Qty ${b.quantity} | ${pnlStr}`;
          })
          .join('\n')
      : '- None recorded.';

  const fixedDeposits = snapshot.fixedDeposits || [];
  const fdTotal = snapshot.fixedDepositTotal ?? fixedDeposits.reduce((s, f) => s + f.currentValue, 0);
  const emergencyFdTotal =
    snapshot.emergencyFdTotal ??
    fixedDeposits.filter((f) => f.countsTowardEmergency).reduce((s, f) => s + f.currentValue, 0);
  const fdRows =
    fixedDeposits.length > 0
      ? fixedDeposits
          .map((f) => {
            const ratePart = f.interestRate ? ` | ${f.interestRate}% p.a.` : '';
            const matPart = f.maturityDate ? ` | Matures ${f.maturityDate}` : '';
            const statusPart = f.countsTowardEmergency ? 'Emergency-Eligible' : 'Tax-Saver / Locked (Excluded)';
            return `- ${f.name} [${f.bank}]: Current ${formatLakh(f.currentValue)} (Principal ${formatLakh(f.investedValue)}, +${formatLakh(f.interestEarned)})${ratePart}${matPart} · ${statusPart}`;
          })
          .join('\n')
      : '- None recorded.';

  const mfRows = snapshot.mutualFunds
    .map(
      (m) =>
        `- ${m.name}: Current ${formatLakh(m.currentValue)}, Invested ${formatLakh(m.investedValue)}, P&L ${m.pnlPct >= 0 ? '+' : ''}${m.pnlPct.toFixed(1)}%`
    )
    .join('\n');

  const sipRows =
    snapshot.activeSips.length > 0
      ? snapshot.activeSips
          .map(
            (s) =>
              `- ${s.fundName} [${s.broker || 'INDmoney'} · ${s.instrumentType || 'MF'}]: ₹${s.amount.toLocaleString('en-IN')} ${s.frequency} (Value ${formatLakh(s.currentValue)}, ${s.gainPct >= 0 ? '+' : ''}${s.gainPct.toFixed(1)}%)`
          )
          .join('\n')
      : '- No active SIP mandates (investor may be investing via lump-sum or direct equity).';

  const insuranceRows =
    insurancePolicies.length > 0
      ? insurancePolicies
          .map(
            (p) =>
              `- [${p.category}] ${p.insurer} — ${p.planName}: Sum Assured ${formatLakh(p.sumAssured)}, Annual Premium ₹${p.annualPremium.toLocaleString('en-IN')}${p.paymentTerm ? `, Term: ${p.paymentTerm}` : ''}${p.renewalDate ? `, Renewal: ${p.renewalDate}` : ''}${p.notes ? ` · Notes: ${p.notes}` : ''}`
          )
          .join('\n')
      : '- No insurance policies recorded yet.';

  const alertRows =
    alerts.length > 0
      ? alerts.map((a) => `- [${a.severity.toUpperCase()}] ${a.title}: ${a.detail}`).join('\n')
      : '- No active deterministic alerts.';

  const upstoxLines =
    snapshot.upstoxState !== 'not_linked'
      ? `- Upstox Cost-Basis Status: ${snapshot.upstoxState}\n- Upstox Idle Margin: ₹${snapshot.upstoxAvailableMargin.toLocaleString('en-IN')}\n`
      : '';

  return `## Portfolio Snapshot (${snapshot.snapshotDate})
- Investor: ${profile.displayName || 'Investor'}
- Mode: ${snapshot.isDemo ? 'Demo Portfolio' : 'Live Linked Accounts'}
${upstoxLines}- Total Net Worth: ₹${snapshot.totalNetworth.toLocaleString('en-IN')} (${(snapshot.totalNetworth / 1e7).toFixed(2)} Cr)
- Adjusted Invested: ₹${snapshot.totalInvestedAdjusted.toLocaleString('en-IN')}
- Unrealized Gain: ${snapshot.totalUnrealizedGain >= 0 ? '+' : ''}₹${snapshot.totalUnrealizedGain.toLocaleString('en-IN')} (${snapshot.totalUnrealizedGainPct >= 0 ? '+' : ''}${snapshot.totalUnrealizedGainPct.toFixed(2)}%)
- Total Liabilities: ₹${snapshot.totalLiabilities.toLocaleString('en-IN')}
- ${deltaLine}
- Emergency Cushion (Savings Account + Callable FDs + Arbitrage MFs): ${formatLakh(snapshot.emergencyCushionTotal)} vs Target ${formatLakh(profile.emergencyTarget)}
- Savings Account Balance: ₹${snapshot.savingsAccountBalance.toLocaleString('en-IN')}
- Fixed Deposits Total: ${formatLakh(fdTotal)} (Emergency-Eligible FDs: ${formatLakh(emergencyFdTotal)})
- Liquid MF Corpus (STP / Near-Cash Pool): ${formatLakh(snapshot.liquidCorpusTotal)}
- Monthly Income (User Configured): ₹${profile.monthlyIncome.toLocaleString('en-IN')}
- Active SIP Outflow: ₹${snapshot.weeklySipOutflow.toLocaleString('en-IN')}/wk + ₹${snapshot.monthlySipOutflow.toLocaleString('en-IN')}/mo (~${formatLakh(snapshot.estimatedMonthlySipTotal)}/mo)

### Asset Allocation
${allocRows}

### Fixed Deposits & Emergency-Linked Assets
${fdRows}

### Top Direct Equities (up to 25 by value)
${topEquities || '- None'}

### Bonds & SGBs (${bonds.length})
${bondRows}

### Mutual Funds
${mfRows || '- None'}

### Active SIP Mandates
${sipRows}

### Insurance & Protection Policies (${insurancePolicies.length})
${insuranceRows}

### Active Deterministic Audit Alerts
${alertRows}

### Investor's Personal Strategy & Goals (User-Edited Markdown)
${profile.strategyMarkdown}
`;
}

export function buildSystemPrompt(): string {
  return `You are Portfolio Pulse AI, a sharp, concise analytical portfolio review assistant for Indian personal finance and multi-broker portfolios.

Rules:
1. Ground every observation strictly in the provided portfolio snapshot, bonds, insurance policies, audit alerts, and the investor's personal strategy notes. Never invent holdings or prices.
2. Use Indian currency conventions (₹, Lakhs "L", Crores "Cr").
3. Highlight concrete risk factors, allocation drift, cashflow/SIP runway, concentration, drawdown watchlists, insurance coverage gaps/redundancies, and alignment against the user's stated milestones.
4. Keep tone objective, analytical, and educational—never claim to be a SEBI-registered investment adviser or IRDAI-licensed insurance adviser. Include a one-line non-advisory reminder at the end of full reports.
5. Format responses in crisp GitHub-flavored Markdown with clear headings and concise bullet points.

Disclaimer context: ${NON_ADVISORY_DISCLAIMER}`;
}

export function buildReviewPrompt(contextBlock: string): string {
  return `Generate a comprehensive, actionable Portfolio Health & Strategy Review from the snapshot below.

Structure your Markdown report with these exact sections:
1. **Executive Summary** (3–4 high-signal takeaways)
2. **Asset Allocation & Risk Assessment** (equity/debt/gold/bonds/SGB/liquidity balance, single-stock concentration)
3. **Cashflow, Emergency Buffer & SIP/Protection Audit** (check SA runway, emergency target gap, active SIP alignment or lump-sum readiness, and insurance protection coverage if recorded)
4. **Holdings Watchlist & Rebalance Considerations** (outperformers vs. deep drawdowns to reassess)
5. **Alignment With Personal Strategy & Upcoming Milestones** (directly address the user's Strategy & Goals Markdown)
6. **Prioritized Checklist (Next 7–30 Days)**

Here is the live portfolio context:

${contextBlock}`;
}

const ADVISOR_TOPIC_LABELS: Record<AdvisorTopic, string> = {
  holdings: 'Direct Stocks / Equities / Bonds',
  mutual_funds: 'Mutual Funds / SIPs / NFOs',
  insurance: 'Insurance / Endowment / ULIP Policy',
  tax_loan: 'Tax Planning / Loan / Prepayment',
  general: 'General Wealth / Advisor Pitch'
};

export function buildAdvisorValidationPrompt(input: {
  topic: AdvisorTopic;
  advisorName?: string;
  pitchText: string;
  attachmentNames?: string[];
  contextBlock: string;
}): string {
  const topicLabel = ADVISOR_TOPIC_LABELS[input.topic] || 'General Wealth / Advisor Pitch';
  const sourceLine = input.advisorName?.trim()
    ? `**Advisor / Institution:** ${input.advisorName.trim()}`
    : '**Advisor / Institution:** External advisor / RM / agent (unspecified)';

  const attachmentsLine =
    input.attachmentNames && input.attachmentNames.length > 0
      ? `**Attached Supporting Documents:** ${input.attachmentNames.join(', ')}\n*(Carefully read every figure, illustration table, premium schedule, fund name, expense ratio, lock-in, and fine-print clause inside the attached document(s)!)*`
      : '';

  const pitchBody = input.pitchText.trim()
    ? input.pitchText.trim()
    : '*(No additional text notes provided — please review the attached document(s) above in full.)*';

  return `The investor wants an objective, critical **Second Opinion** on an external recommendation they received.

**Topic Category:** ${topicLabel}
${sourceLine}
${attachmentsLine}

### Recommendation / Pitch Received by Investor
${pitchBody}

---

Evaluate this recommendation (including all attached brochures, illustrations, quotes, or screenshots) thoroughly **against the investor's actual live portfolio, insurance policies, and personal strategy below**. Be candid, protective of the investor's interests, and check carefully for common Indian retail wealth-management pitfalls (e.g., Regular vs. Direct mutual fund trail commissions, unnecessary NFOs/sectoral funds, endowment/guaranteed/ULIP plans with low 4–6% effective IRR or high lock-in vs. Pure Term + Index Fund, duplicating existing holdings, violating emergency buffer, or misaligning with stated goals).

Structure your Markdown response with these exact sections:
1. **Second-Opinion Verdict** — State clearly whether this looks **Well-Aligned**, **Needs Caution / Clarification**, or **Likely Conflict / Poor Fit**, with a 2–3 sentence rationale.
2. **Key Numbers & Fine Print Extracted From the Pitch / Attachments** — Summarize the exact amounts, tenures, premiums, expected IRR/returns, fund names, or clauses found in the recommendation/files.
3. **Impact on Your Live Portfolio & Coverage** — Reference specific existing holdings, allocation weights, bonds/SGBs, cash buffer, or insurance policies from the context below.
4. **Hidden Costs, Lock-ins & Trade-offs to Check** — Call out expense ratios, Regular vs. Direct, lock-in periods, surrender penalties, tax treatment (LTCG/STCG/10(10D)), or realistic expected IRR.
5. **Alternative Options to Compare** — Give 1–2 simpler, lower-cost educational benchmarks to compare against (where relevant).
6. **5 Sharp Questions to Ask Your Advisor Before Deciding** — Concrete, polite questions the investor can copy-paste or ask verbatim.

End with a brief one-line reminder that this is an educational AI second opinion, not regulated SEBI/IRDAI advice.

---

### Investor's Live Portfolio, Policies & Strategy Context

${input.contextBlock}`;
}

export function buildInsuranceExtractionPrompt(fileName: string, docType: 'policy' | 'renewal'): string {
  return `Extract structured Indian insurance policy details from the attached ${docType === 'renewal' ? 'renewal receipt / renewal schedule' : 'policy document'} ("${fileName}").

Return ONLY a valid JSON object (no markdown fences, no commentary) with these exact keys:
{
  "category": "Term Life" | "Health" | "Endowment / Guaranteed" | "ULIP" | "Vehicle / Other",
  "insurer": "string (e.g. HDFC Life, HDFC Ergo, LIC, ICICI Prudential, Niva Bupa, Star Health)",
  "planName": "string (exact product / plan name)",
  "sumAssured": number (total Sum Assured / Base Cover in INR as plain integer, e.g. 10000000 for 1 Cr or 1500000 for 15L; 0 if not found),
  "annualPremium": number (annualized total premium incl. GST in INR as plain integer; 0 if not found),
  "renewalDate": "string (next renewal / due / expiry date formatted cleanly e.g. '15-Mar-2027' or '15-Mar'; empty string if not found)",
  "paymentTerm": "string (e.g. 'Annual', '10 Years PPT / 30 Years Term', 'Regular Pay till Age 60'; empty string if not found)",
  "notes": "string (concise 1-line summary: Policy Number, riders, family members covered, waiting periods, or maturity year if present)"
}`;
}
