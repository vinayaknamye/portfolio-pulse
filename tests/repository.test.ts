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
    expect(snap.reconciliation.nonEquityCount).toBe(2); // 1 SGB + 1 NCD
    expect(snap.bonds).toHaveLength(2);
    expect(snap.reconciliation.externalCount).toBe(1);
    expect(snap.reconciliation.unmatchedIndmoney).toHaveLength(0);
    expect(repo.getInsurancePolicies(true)).toHaveLength(2);

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

    // Test Insurance Policy CRUD (live namespace isolated from demo)
    expect(repo.getInsurancePolicies(false)).toHaveLength(0);
    const savedPol = repo.saveInsurancePolicy(false, {
      category: 'Term Life',
      insurer: 'ICICI Prudential',
      planName: 'iProtect Smart',
      sumAssured: 15000000,
      annualPremium: 19500,
      renewalDate: '01-Sep',
      paymentTerm: 'Regular till 60',
      notes: 'Pure term'
    });
    expect(savedPol.id).toBeGreaterThan(0);
    expect(repo.getInsurancePolicies(false)).toHaveLength(1);
    repo.saveInsurancePolicy(false, { ...savedPol, annualPremium: 20500 });
    expect(repo.getInsurancePolicies(false)[0].annualPremium).toBe(20500);

    // Test Insurance Policy & Renewal document vault records + cascade delete
    const docPolicy = repo.addInsuranceDocument({
      policyId: savedPol.id!,
      docType: 'policy',
      fileName: 'iprotect-policy.pdf',
      storedRelPath: 'insurance/policy-3/iprotect-policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 245000,
      docDate: '2025-09-01'
    });
    const docRenewal = repo.addInsuranceDocument({
      policyId: savedPol.id!,
      docType: 'renewal',
      fileName: 'renewal-2026.pdf',
      storedRelPath: 'insurance/policy-3/renewal-2026.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 118000,
      docDate: '2026-09-01'
    });
    const withDocs = repo.getInsurancePolicies(false)[0].documents || [];
    expect(withDocs).toHaveLength(2);
    expect(withDocs[0].docType).toBe('policy');
    expect(withDocs[1].docType).toBe('renewal');
    expect(repo.getInsuranceDocumentWithPath(docPolicy.id)?.storedRelPath).toBe('insurance/policy-3/iprotect-policy.pdf');

    const removedRenewalPath = repo.deleteInsuranceDocument(docRenewal.id);
    expect(removedRenewalPath).toBe('insurance/policy-3/renewal-2026.pdf');
    expect(repo.getInsurancePolicies(false)[0].documents).toHaveLength(1);

    const cascadedPaths = repo.deleteInsurancePolicy(savedPol.id!);
    expect(cascadedPaths).toEqual(['insurance/policy-3/iprotect-policy.pdf']);
    expect(repo.getInsurancePolicies(false)).toHaveLength(0);
    // Demo policies remain untouched
    expect(repo.getInsurancePolicies(true)).toHaveLength(2);

    // Test CostBasisOverride persistence + legacy v0.1.0 broker-less CSV deduplication on re-import
    repo.saveCostOverride({
      holdingKey: 'name:itchotels',
      displayName: 'ITC Hotels Limited',
      averagePrice: 585.25,
      source: 'csv_import',
      updatedAt: '2026-11-20T00:00:00Z'
    });
    repo.saveCostOverridesBulk([
      {
        holdingKey: 'name:itchotelslimited@paytmmoney',
        displayName: 'ITC Hotels Limited',
        broker: 'Paytm Money',
        averagePrice: 585.25,
        csvQty: 16,
        csvCurrentPrice: 184.25,
        source: 'csv_import',
        updatedAt: '2026-11-22T00:00:00Z'
      },
      {
        holdingKey: 'name:swiggy@paytmmoney',
        displayName: 'Swiggy Limited',
        broker: 'Paytm Money',
        averagePrice: 390,
        csvQty: 20,
        csvCurrentPrice: 178.2,
        source: 'csv_import',
        updatedAt: '2026-11-22T00:00:00Z'
      }
    ]);
    const overrides = repo.getCostOverrides();
    expect(overrides).toHaveLength(2); // Legacy broker-less ITC Hotels row was cleanly replaced, not duplicated!
    expect(overrides.find((o) => o.displayName === 'ITC Hotels Limited')?.broker).toBe('Paytm Money');
    const swiggyOv = overrides.find((o) => o.displayName === 'Swiggy Limited');
    expect(swiggyOv?.csvQty).toBe(20);
    expect(swiggyOv?.csvCurrentPrice).toBe(178.2);

    db.close();
  });
});
