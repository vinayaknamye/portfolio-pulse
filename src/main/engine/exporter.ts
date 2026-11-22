import fs from 'fs';
import path from 'path';
import { AuditAlert, InsurancePolicy, PortfolioSnapshot, UserProfile } from '@shared/types';
import { NON_ADVISORY_DISCLAIMER } from '@shared/constants';

function formatLakh(val: number): string {
  return `₹${(val / 100000).toFixed(2)}L`;
}

function formatCr(val: number): string {
  return `₹${(val / 10000000).toFixed(2)} Cr`;
}

export function generatePortfolioMarkdown(
  snapshot: PortfolioSnapshot,
  alerts: AuditAlert[],
  profile: UserProfile,
  insurancePolicies: InsurancePolicy[] = []
): string {
  const lines: string[] = [];
  const ownerPrefix = profile.displayName?.trim() ? `${profile.displayName.trim()} — ` : '';

  lines.push(`# ${ownerPrefix}Portfolio Pulse Snapshot (${snapshot.snapshotDate})`);
  lines.push('');
  const upstoxMeta = snapshot.upstoxState !== 'not_linked' ? ` · **Upstox Status:** ${snapshot.upstoxState}` : '';
  lines.push(`**Fetched At:** ${snapshot.fetchedAt} · **Mode:** ${snapshot.isDemo ? 'Demo Portfolio' : 'Live MCP'}${upstoxMeta}`);
  lines.push('');
  lines.push(`> ${NON_ADVISORY_DISCLAIMER}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Net Worth & Liquidity Overview');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  lines.push(`| **Total Net Worth** | **${formatCr(snapshot.totalNetworth)}** (₹${snapshot.totalNetworth.toLocaleString('en-IN', { maximumFractionDigits: 2 })}) |`);
  lines.push(`| **Adjusted Invested** | ${formatCr(snapshot.totalInvestedAdjusted)} |`);
  lines.push(`| **Unrealized Gain** | ${snapshot.totalUnrealizedGain >= 0 ? '+' : ''}${formatLakh(snapshot.totalUnrealizedGain)} (${snapshot.totalUnrealizedGainPct >= 0 ? '+' : ''}${snapshot.totalUnrealizedGainPct.toFixed(2)}%) |`);
  lines.push(`| **Total Liabilities** | ₹${snapshot.totalLiabilities.toLocaleString('en-IN')} |`);
  lines.push(`| **Emergency Cushion (Arbitrage + SA)** | ${formatLakh(snapshot.emergencyCushionTotal)} (Target: ${formatLakh(profile.emergencyTarget)}) |`);
  lines.push(`| **Liquid Fund Corpus** | ${formatLakh(snapshot.liquidCorpusTotal)} |`);
  if (snapshot.upstoxState !== 'not_linked') {
    lines.push(`| **Upstox Available Margin** | ₹${snapshot.upstoxAvailableMargin.toLocaleString('en-IN', { maximumFractionDigits: 2 })} |`);
  }
  lines.push('');
  lines.push('### Asset Allocation');
  lines.push('');
  lines.push('| Asset | Invested | Current | Return % | Weight |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const a of snapshot.allocations) {
    lines.push(
      `| **${a.assetType}** | ${formatLakh(a.investedValue)} | ${formatLakh(a.currentValue)} | ${a.returnPct >= 0 ? '+' : ''}${a.returnPct.toFixed(2)}% | ${a.weightPct.toFixed(2)}% |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## 2. Direct Equities (${snapshot.equities.length})`);
  lines.push('');
  lines.push('| Name | Broker | Qty | Avg Price | LTP | Value | P&L % |');
  lines.push('|---|---|---:|---:|---:|---:|---:|');
  for (const e of snapshot.equities) {
    const avgStr = e.averagePrice !== null ? `₹${e.averagePrice.toFixed(2)}` : 'N/A';
    const pnlStr = e.costBasisSource === 'market_value_proxy' ? 'N/A' : `${e.pnlPct >= 0 ? '+' : ''}${e.pnlPct.toFixed(1)}%`;
    lines.push(
      `| ${e.name} | ${e.broker} | ${e.quantity} | ${avgStr} | ₹${e.lastPrice.toFixed(2)} | ${formatLakh(e.currentValue)} | ${pnlStr} |`
    );
  }
  lines.push('');
  const bonds = snapshot.bonds || [];
  if (bonds.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## 3. Bonds & SGBs (${bonds.length})`);
    lines.push('');
    lines.push('| Instrument | Type | Broker | Qty | Avg Price | LTP | Value | P&L % |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|');
    for (const b of bonds) {
      const avgStr = b.averagePrice !== null ? `₹${b.averagePrice.toFixed(2)}` : 'N/A';
      const pnlStr = b.costBasisSource === 'market_value_proxy' ? 'N/A' : `${b.pnlPct >= 0 ? '+' : ''}${b.pnlPct.toFixed(1)}%`;
      lines.push(
        `| ${b.name} | ${b.bondType} | ${b.broker} | ${b.quantity} | ${avgStr} | ₹${b.lastPrice.toFixed(2)} | ${formatLakh(b.currentValue)} | ${pnlStr} |`
      );
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(`## 4. Mutual Funds (${snapshot.mutualFunds.length}) & Active SIPs (${snapshot.activeSips.length})`);
  lines.push('');
  lines.push('| Fund | Units | NAV | Invested | Current | P&L % |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const m of snapshot.mutualFunds) {
    lines.push(
      `| ${m.name} | ${m.units.toFixed(2)} | ₹${m.nav.toFixed(2)} | ${formatLakh(m.investedValue)} | ${formatLakh(m.currentValue)} | ${m.pnlPct >= 0 ? '+' : ''}${m.pnlPct.toFixed(2)}% |`
    );
  }
  lines.push('');
  if (snapshot.activeSips.length > 0) {
    lines.push(`**Active SIP Outflow:** ₹${snapshot.weeklySipOutflow.toLocaleString('en-IN')}/week + ₹${snapshot.monthlySipOutflow.toLocaleString('en-IN')}/month (~${formatLakh(snapshot.estimatedMonthlySipTotal)}/month)`);
    lines.push('');
    lines.push('| Instrument | Broker | Type | Amount | Frequency | Start / Next |');
    lines.push('|---|---|---|---:|---|---|');
    for (const s of snapshot.activeSips) {
      lines.push(
        `| ${s.fundName} | ${s.broker || 'INDmoney'} | ${s.instrumentType || 'MF'} | ₹${s.amount.toLocaleString('en-IN')} | ${s.frequency} | ${s.nextInstallmentDate || s.startDate || 'N/A'} |`
      );
    }
    lines.push('');
  }
  if (insurancePolicies.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## 5. Insurance & Protection Policies (${insurancePolicies.length})`);
    lines.push('');
    lines.push('| Category | Insurer | Plan | Sum Assured | Annual Premium | Term | Renewal |');
    lines.push('|---|---|---|---:|---:|---|---|');
    for (const p of insurancePolicies) {
      lines.push(
        `| ${p.category} | ${p.insurer} | ${p.planName} | ${formatLakh(p.sumAssured)} | ₹${p.annualPremium.toLocaleString('en-IN')} | ${p.paymentTerm || '—'} | ${p.renewalDate || '—'} |`
      );
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(`## 6. Audit Alerts (${alerts.length})`);
  lines.push('');
  if (alerts.length === 0) {
    lines.push('- No active alerts — all portfolio checks passed.');
  } else {
    for (const a of alerts) {
      lines.push(`- **[${a.severity.toUpperCase()}] ${a.title}:** ${a.detail}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 7. Personal Strategy & Goals');
  lines.push('');
  lines.push(profile.strategyMarkdown);
  lines.push('');

  return lines.join('\n');
}

export function exportPortfolioBundle(
  targetDir: string,
  snapshot: PortfolioSnapshot,
  alerts: AuditAlert[],
  profile: UserProfile,
  insurancePolicies: InsurancePolicy[] = []
): { directory: string; files: string[] } {
  const bundleDir = path.join(targetDir, `portfolio-pulse-export-${snapshot.snapshotDate}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  const files: string[] = [];
  const write = (name: string, content: string) => {
    const full = path.join(bundleDir, name);
    fs.writeFileSync(full, content, 'utf-8');
    files.push(full);
  };

  write('PORTFOLIO_SNAPSHOT.md', generatePortfolioMarkdown(snapshot, alerts, profile, insurancePolicies));
  write('snapshot.json', JSON.stringify(snapshot, null, 2));
  write('alerts.json', JSON.stringify(alerts, null, 2));
  write('insurance_policies.json', JSON.stringify(insurancePolicies, null, 2));
  write('strategy.md', profile.strategyMarkdown);

  return { directory: bundleDir, files };
}
