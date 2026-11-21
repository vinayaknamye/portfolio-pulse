import { AuditAlert, PortfolioSnapshot, UserProfile } from '@shared/types';
import { NON_ADVISORY_DISCLAIMER } from '@shared/constants';

function formatLakh(val: number): string {
  return `₹${(val / 100000).toFixed(2)}L`;
}

export function buildPortfolioContextBlock(
  snapshot: PortfolioSnapshot,
  previous: PortfolioSnapshot | null,
  alerts: AuditAlert[],
  profile: UserProfile
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
    .slice(0, 20)
    .map((e) => {
      const pnlStr = e.costBasisSource === 'market_value_proxy' ? 'cost basis N/A' : `${e.pnlPct >= 0 ? '+' : ''}${e.pnlPct.toFixed(1)}%`;
      return `- ${e.symbol} (${e.name}, ${e.broker}): ${formatLakh(e.currentValue)} | Qty ${e.quantity} | ${pnlStr}`;
    })
    .join('\n');

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
      : '- No active SIP mandates detected.';

  const alertRows =
    alerts.length > 0
      ? alerts.map((a) => `- [${a.severity.toUpperCase()}] ${a.title}: ${a.detail}`).join('\n')
      : '- No active deterministic alerts.';

  return `## Portfolio Snapshot (${snapshot.snapshotDate})
- Mode: ${snapshot.isDemo ? 'Demo Portfolio' : 'Live Linked Accounts'}
- Upstox Cost-Basis Status: ${snapshot.upstoxState}
- Total Net Worth: ₹${snapshot.totalNetworth.toLocaleString('en-IN')} (${(snapshot.totalNetworth / 1e7).toFixed(2)} Cr)
- Adjusted Invested: ₹${snapshot.totalInvestedAdjusted.toLocaleString('en-IN')}
- Unrealized Gain: ${snapshot.totalUnrealizedGain >= 0 ? '+' : ''}₹${snapshot.totalUnrealizedGain.toLocaleString('en-IN')} (${snapshot.totalUnrealizedGainPct >= 0 ? '+' : ''}${snapshot.totalUnrealizedGainPct.toFixed(2)}%)
- Total Liabilities: ₹${snapshot.totalLiabilities.toLocaleString('en-IN')}
- ${deltaLine}
- Emergency Cushion (Arbitrage + SA): ${formatLakh(snapshot.emergencyCushionTotal)} vs Target ${formatLakh(profile.emergencyTarget)}
- Savings Account Balance: ₹${snapshot.savingsAccountBalance.toLocaleString('en-IN')}
- Upstox Idle Margin: ₹${snapshot.upstoxAvailableMargin.toLocaleString('en-IN')}
- Liquid MF Corpus (STP Source): ${formatLakh(snapshot.liquidCorpusTotal)}
- Monthly Income (User Configured): ₹${profile.monthlyIncome.toLocaleString('en-IN')}
- Active SIP Outflow: ₹${snapshot.weeklySipOutflow.toLocaleString('en-IN')}/wk + ₹${snapshot.monthlySipOutflow.toLocaleString('en-IN')}/mo (~${formatLakh(snapshot.estimatedMonthlySipTotal)}/mo)

### Asset Allocation
${allocRows}

### Top Direct Equities (up to 20 by value)
${topEquities || '- None'}

### Mutual Funds
${mfRows || '- None'}

### Active SIP Mandates
${sipRows}

### Active Deterministic Audit Alerts
${alertRows}

### Investor's Personal Strategy & Goals (User-Edited Markdown)
${profile.strategyMarkdown}
`;
}

export function buildSystemPrompt(): string {
  return `You are Portfolio Pulse AI, a sharp, concise analytical portfolio review assistant for Indian personal finance and multi-broker portfolios.

Rules:
1. Ground every observation strictly in the provided portfolio snapshot, audit alerts, and the investor's personal strategy notes. Never invent holdings or prices.
2. Use Indian currency conventions (₹, Lakhs "L", Crores "Cr").
3. Highlight concrete risk factors, allocation drift, cashflow/SIP runway, concentration, drawdown watchlists, and alignment against the user's stated milestones.
4. Keep tone objective, analytical, and educational—never claim to be a SEBI-registered investment adviser. Include a one-line non-advisory reminder at the end of full reports.
5. Format responses in crisp GitHub-flavored Markdown with clear headings and concise bullet points.

Disclaimer context: ${NON_ADVISORY_DISCLAIMER}`;
}

export function buildReviewPrompt(contextBlock: string): string {
  return `Generate a comprehensive, actionable Portfolio Health & Strategy Review from the snapshot below.

Structure your Markdown report with these exact sections:
1. **Executive Summary** (3–4 high-signal takeaways)
2. **Asset Allocation & Risk Assessment** (equity/debt/gold/liquidity balance, single-stock concentration)
3. **Cashflow, Emergency Buffer & SIP/STP Audit** (check SA runway, emergency target gap, idle broker cash, SIP alignment)
4. **Holdings Watchlist & Rebalance Considerations** (outperformers vs. deep drawdowns to reassess)
5. **Alignment With Personal Strategy & Upcoming Milestones** (directly address the user's Strategy & Goals Markdown)
6. **Prioritized Checklist (Next 7–30 Days)**

Here is the live portfolio context:

${contextBlock}`;
}
