import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PROFILE } from '@shared/constants';
import { LocalDatabase } from '@main/db/database';
import { PortfolioRepository } from '@main/db/repository';
import { ensureDemoSeeded } from '@main/demo/demoDataset';

describe('LocalDatabase & PortfolioRepository (sql.js)', () => {
  it('seeds 14 days of synthetic Demo Mode snapshots, baselines, and audit alerts cleanly in memory', async () => {
    const db = await LocalDatabase.open(null);
    const repo = new PortfolioRepository(db);

    const snap = ensureDemoSeeded(repo, { ...DEFAULT_USER_PROFILE });
    expect(snap.isDemo).toBe(true);
    expect(snap.totalNetworth).toBeGreaterThan(0);
    expect(snap.reconciliation.nonEquityCount).toBe(1);
    expect(snap.reconciliation.externalCount).toBe(1);
    expect(snap.reconciliation.unmatchedIndmoney).toHaveLength(0);

    const history = repo.getSnapshotHistory(true);
    expect(history).toHaveLength(14);

    const alerts = repo.getAlerts(true);
    expect(alerts.length).toBeGreaterThan(0);
    // Demo dataset intentionally showcases idle Upstox margin + TATAMOTORS drawdown
    expect(alerts.some((a) => a.category === 'margin')).toBe(true);
    expect(alerts.some((a) => a.category === 'drawdown')).toBe(true);

    // Ensure Live namespace remains completely isolated from Demo data
    expect(repo.getLatestSnapshot(false)).toBeNull();
    expect(repo.getAlerts(false)).toHaveLength(0);

    // Test AI Report + Chat persistence
    const report = repo.saveAIReport({
      isDemo: true,
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      title: 'Test Review',
      markdown: '# Summary\nLooks good.'
    });
    expect(report.id).toBeGreaterThan(0);
    expect(repo.getAIReports(true)).toHaveLength(1);

    repo.addChatMessage(true, { role: 'user', content: 'Check risk', createdAt: new Date().toISOString() });
    expect(repo.getChatMessages(true)).toHaveLength(1);
    repo.clearChatMessages(true);
    expect(repo.getChatMessages(true)).toHaveLength(0);

    db.close();
  });
});
