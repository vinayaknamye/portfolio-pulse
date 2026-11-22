import {
  AIChatMessage,
  AIReportRecord,
  AuditAlert,
  BrokerConnectionStatus,
  BrokerId,
  CostBasisOverride,
  InsuranceDocument,
  InsuranceDocumentType,
  InsurancePolicy,
  PortfolioSnapshot,
  SipBaselineItem,
  SnapshotHistoryPoint,
  SymbolAlias,
  UpstoxSyncState,
  UserProfile
} from '@shared/types';
import { DEFAULT_USER_PROFILE } from '@shared/constants';
import { PreviousUpstoxCostBasis } from '@main/engine/reconciler';
import { LocalDatabase } from './database';

export class PortfolioRepository {
  constructor(private readonly db: LocalDatabase) {}

  // --- Meta & Mode ---
  getMeta(key: string): string | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value]);
  }

  isDemoMode(): boolean {
    return this.getMeta('is_demo_mode') === 'true';
  }

  setDemoMode(enabled: boolean): void {
    this.setMeta('is_demo_mode', enabled ? 'true' : 'false');
  }

  getProfile(): UserProfile {
    const raw = this.getMeta('user_profile');
    if (!raw) return { ...DEFAULT_USER_PROFILE };
    try {
      return { ...DEFAULT_USER_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) };
    } catch {
      return { ...DEFAULT_USER_PROFILE };
    }
  }

  saveProfile(partial: Partial<UserProfile>): UserProfile {
    const next = { ...this.getProfile(), ...partial };
    this.setMeta('user_profile', JSON.stringify(next));
    return next;
  }

  // --- Broker Status ---
  getBrokerStatuses(): Record<BrokerId, BrokerConnectionStatus> {
    const defaults: Record<BrokerId, BrokerConnectionStatus> = {
      indmoney: { broker: 'indmoney', state: 'disconnected', lastSyncAt: null, lastError: null },
      upstox: { broker: 'upstox', state: 'disconnected', lastSyncAt: null, lastError: null }
    };
    const rows = this.db.all<{
      broker: BrokerId;
      state: BrokerConnectionStatus['state'];
      last_sync_at: string | null;
      last_error: string | null;
    }>('SELECT broker, state, last_sync_at, last_error FROM broker_status');

    for (const r of rows) {
      if (r.broker === 'indmoney' || r.broker === 'upstox') {
        defaults[r.broker] = {
          broker: r.broker,
          state: r.state,
          lastSyncAt: r.last_sync_at,
          lastError: r.last_error
        };
      }
    }
    return defaults;
  }

  setBrokerStatus(status: BrokerConnectionStatus): void {
    this.db.run(
      'INSERT OR REPLACE INTO broker_status (broker, state, last_sync_at, last_error) VALUES (?, ?, ?, ?)',
      [status.broker, status.state, status.lastSyncAt, status.lastError]
    );
  }

  // --- Snapshots ---
  saveSnapshot(snapshot: PortfolioSnapshot): number {
    const demoFlag = snapshot.isDemo ? 1 : 0;
    // Keep one latest snapshot per calendar day per mode by replacing same-day entry
    const existing = this.db.get<{ id: number }>(
      'SELECT id FROM snapshots WHERE is_demo = ? AND snapshot_date = ? ORDER BY id DESC LIMIT 1',
      [demoFlag, snapshot.snapshotDate]
    );

    if (existing) {
      const updated = { ...snapshot, id: existing.id };
      this.db.run(
        `UPDATE snapshots
         SET fetched_at = ?, upstox_state = ?, total_networth = ?, total_invested_adjusted = ?, payload_json = ?
         WHERE id = ?`,
        [
          updated.fetchedAt,
          updated.upstoxState,
          updated.totalNetworth,
          updated.totalInvestedAdjusted,
          JSON.stringify(updated),
          existing.id
        ]
      );
      return existing.id;
    }

    this.db.run(
      `INSERT INTO snapshots (is_demo, snapshot_date, fetched_at, upstox_state, total_networth, total_invested_adjusted, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        demoFlag,
        snapshot.snapshotDate,
        snapshot.fetchedAt,
        snapshot.upstoxState,
        snapshot.totalNetworth,
        snapshot.totalInvestedAdjusted,
        JSON.stringify(snapshot)
      ]
    );
    const id = this.db.getLastInsertId();
    const withId = { ...snapshot, id };
    this.db.run('UPDATE snapshots SET payload_json = ? WHERE id = ?', [JSON.stringify(withId), id]);
    return id;
  }

  getLatestSnapshot(isDemo: boolean): PortfolioSnapshot | null {
    const row = this.db.get<{ id: number; payload_json: string }>(
      'SELECT id, payload_json FROM snapshots WHERE is_demo = ? ORDER BY snapshot_date DESC, id DESC LIMIT 1',
      [isDemo ? 1 : 0]
    );
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as PortfolioSnapshot;
    return { ...parsed, id: row.id };
  }

  getPreviousSnapshot(isDemo: boolean, excludeDate?: string): PortfolioSnapshot | null {
    const row = excludeDate
      ? this.db.get<{ id: number; payload_json: string }>(
          'SELECT id, payload_json FROM snapshots WHERE is_demo = ? AND snapshot_date < ? ORDER BY snapshot_date DESC, id DESC LIMIT 1',
          [isDemo ? 1 : 0, excludeDate]
        )
      : this.db.get<{ id: number; payload_json: string }>(
          'SELECT id, payload_json FROM snapshots WHERE is_demo = ? ORDER BY snapshot_date DESC, id DESC LIMIT 1 OFFSET 1',
          [isDemo ? 1 : 0]
        );
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as PortfolioSnapshot;
    return { ...parsed, id: row.id };
  }

  getLastLiveUpstoxCostBasis(isDemo: boolean): PreviousUpstoxCostBasis[] {
    // Scan recent live snapshots and pick the newest one that actually contains Upstox live avg prices
    // so an empty/degraded sync can never erase historical cost-basis carry-forward.
    const rows = this.db.all<{ payload_json: string }>(
      `SELECT payload_json FROM snapshots
       WHERE is_demo = ? AND upstox_state = 'live'
       ORDER BY snapshot_date DESC, id DESC LIMIT 15`,
      [isDemo ? 1 : 0]
    );
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload_json) as PortfolioSnapshot;
        const items = parsed.equities
          .filter(
            (e) =>
              !e.isNonEquity &&
              !e.isExternalBroker &&
              e.averagePrice !== null &&
              e.averagePrice > 0 &&
              (e.costBasisSource === 'upstox_live' || e.costBasisSource === 'upstox_carried_forward')
          )
          .map((e) => ({
            symbol: e.symbol,
            name: e.name,
            isin: e.isin,
            averagePrice: e.averagePrice as number
          }));
        if (items.length > 0) return items;
      } catch {
        // Ignore malformed historical payload
      }
    }
    return [];
  }

  getSnapshotHistory(isDemo: boolean, limit = 90): SnapshotHistoryPoint[] {
    const rows = this.db.all<{
      id: number;
      snapshot_date: string;
      fetched_at: string;
      total_networth: number;
      total_invested_adjusted: number;
      upstox_state: UpstoxSyncState;
    }>(
      `SELECT id, snapshot_date, fetched_at, total_networth, total_invested_adjusted, upstox_state
       FROM snapshots
       WHERE is_demo = ?
       ORDER BY snapshot_date ASC, id ASC
       LIMIT ?`,
      [isDemo ? 1 : 0, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      snapshotDate: r.snapshot_date,
      fetchedAt: r.fetched_at,
      totalNetworth: r.total_networth,
      totalInvestedAdjusted: r.total_invested_adjusted,
      upstoxState: r.upstox_state
    }));
  }

  // --- Alerts ---
  replaceAlertsForSnapshot(isDemo: boolean, snapshotId: number, alerts: AuditAlert[]): void {
    const demoFlag = isDemo ? 1 : 0;
    this.db.execBatch((rawDb) => {
      rawDb.run('DELETE FROM alerts WHERE is_demo = ? AND snapshot_id = ?', [demoFlag, snapshotId]);
      // Keep alerts table focused on latest run + recent history
      rawDb.run('DELETE FROM alerts WHERE is_demo = ? AND snapshot_id IS NOT NULL AND snapshot_id != ?', [
        demoFlag,
        snapshotId
      ]);
      for (const a of alerts) {
        rawDb.run(
          `INSERT OR REPLACE INTO alerts (id, is_demo, snapshot_id, category, severity, title, detail, created_at, dismissed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, demoFlag, snapshotId, a.category, a.severity, a.title, a.detail, a.createdAt, a.dismissed ? 1 : 0]
        );
      }
    });
  }

  getAlerts(isDemo: boolean): AuditAlert[] {
    const rows = this.db.all<{
      id: string;
      snapshot_id: number;
      category: AuditAlert['category'];
      severity: AuditAlert['severity'];
      title: string;
      detail: string;
      created_at: string;
      dismissed: number;
    }>(
      `SELECT id, snapshot_id, category, severity, title, detail, created_at, dismissed
       FROM alerts
       WHERE is_demo = ?
       ORDER BY CASE severity WHEN 'action' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC`,
      [isDemo ? 1 : 0]
    );

    return rows.map((r) => ({
      id: r.id,
      snapshotId: r.snapshot_id,
      category: r.category,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      createdAt: r.created_at,
      dismissed: r.dismissed === 1
    }));
  }

  dismissAlert(alertId: string): void {
    this.db.run('UPDATE alerts SET dismissed = 1 WHERE id = ?', [alertId]);
  }

  // --- SIP Baselines ---
  getSipBaselines(isDemo: boolean): SipBaselineItem[] {
    const rows = this.db.all<{
      id: number;
      fund_name: string;
      expected_amount: number;
      expected_frequency: SipBaselineItem['expectedFrequency'];
      active: number;
    }>('SELECT id, fund_name, expected_amount, expected_frequency, active FROM sip_baselines WHERE is_demo = ? ORDER BY fund_name ASC', [
      isDemo ? 1 : 0
    ]);
    return rows.map((r) => ({
      id: r.id,
      fundName: r.fund_name,
      expectedAmount: r.expected_amount,
      expectedFrequency: r.expected_frequency,
      active: r.active === 1
    }));
  }

  saveSipBaselines(isDemo: boolean, items: SipBaselineItem[]): void {
    const demoFlag = isDemo ? 1 : 0;
    this.db.execBatch((rawDb) => {
      rawDb.run('DELETE FROM sip_baselines WHERE is_demo = ?', [demoFlag]);
      for (const item of items) {
        rawDb.run(
          `INSERT INTO sip_baselines (is_demo, fund_name, expected_amount, expected_frequency, active)
           VALUES (?, ?, ?, ?, ?)`,
          [demoFlag, item.fundName, item.expectedAmount, item.expectedFrequency, item.active ? 1 : 0]
        );
      }
    });
  }

  seedSipBaselinesIfEmpty(isDemo: boolean, snapshot: PortfolioSnapshot): void {
    const existing = this.getSipBaselines(isDemo);
    if (existing.length > 0 || snapshot.activeSips.length === 0) return;
    const unique = new Map<string, SipBaselineItem>();
    for (const s of snapshot.activeSips) {
      if (!unique.has(s.fundName)) {
        unique.set(s.fundName, {
          fundName: s.fundName,
          expectedAmount: s.amount,
          expectedFrequency: s.frequency,
          active: true
        });
      }
    }
    this.saveSipBaselines(isDemo, Array.from(unique.values()));
  }

  // --- Symbol Aliases ---
  getAliases(): SymbolAlias[] {
    const rows = this.db.all<{ indmoney_name: string; upstox_symbol: string }>(
      'SELECT indmoney_name, upstox_symbol FROM symbol_aliases ORDER BY indmoney_name ASC'
    );
    return rows.map((r) => ({ indmoneyName: r.indmoney_name, upstoxSymbol: r.upstox_symbol }));
  }

  saveAlias(alias: SymbolAlias): void {
    this.db.run(
      'INSERT OR REPLACE INTO symbol_aliases (indmoney_name, upstox_symbol) VALUES (?, ?)',
      [alias.indmoneyName.trim(), alias.upstoxSymbol.trim().toUpperCase()]
    );
  }

  deleteAlias(indmoneyName: string): void {
    this.db.run('DELETE FROM symbol_aliases WHERE indmoney_name = ?', [indmoneyName]);
  }

  // --- Manual / CSV Cost Basis Overrides ---
  getCostOverrides(): CostBasisOverride[] {
    const rows = this.db.all<{
      holding_key: string;
      display_name: string;
      symbol: string | null;
      isin: string | null;
      broker: string | null;
      average_price: number;
      csv_qty: number | null;
      csv_current_price: number | null;
      source: 'manual' | 'csv_import';
      updated_at: string;
    }>(
      `SELECT holding_key, display_name, symbol, isin, broker, average_price, csv_qty, csv_current_price, source, updated_at
       FROM cost_basis_overrides
       ORDER BY display_name ASC`
    );
    return rows.map((r) => ({
      holdingKey: r.holding_key,
      displayName: r.display_name,
      symbol: r.symbol || undefined,
      isin: r.isin || undefined,
      broker: r.broker || undefined,
      averagePrice: r.average_price,
      csvQty: r.csv_qty !== null && r.csv_qty !== undefined ? Number(r.csv_qty) : undefined,
      csvCurrentPrice:
        r.csv_current_price !== null && r.csv_current_price !== undefined ? Number(r.csv_current_price) : undefined,
      source: r.source === 'csv_import' ? 'csv_import' : 'manual',
      updatedAt: r.updated_at
    }));
  }

  saveCostOverride(item: CostBasisOverride): void {
    this.db.run(
      `INSERT OR REPLACE INTO cost_basis_overrides
       (holding_key, display_name, symbol, isin, broker, average_price, csv_qty, csv_current_price, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.holdingKey.trim().toLowerCase(),
        item.displayName.trim(),
        item.symbol?.trim().toUpperCase() || null,
        item.isin?.trim().toUpperCase() || null,
        item.broker?.trim() || null,
        item.averagePrice,
        item.csvQty ?? null,
        item.csvCurrentPrice ?? null,
        item.source,
        item.updatedAt
      ]
    );
  }

  saveCostOverridesBulk(items: CostBasisOverride[]): void {
    if (items.length === 0) return;
    this.db.execBatch((rawDb) => {
      for (const item of items) {
        // Cleanly upgrade legacy v0.1.0 broker-less CSV rows so re-importing a broker CSV never creates duplicates
        if (item.source === 'csv_import' && item.broker?.trim()) {
          rawDb.run(
            `DELETE FROM cost_basis_overrides
             WHERE source = 'csv_import' AND broker IS NULL AND LOWER(display_name) = ?`,
            [item.displayName.trim().toLowerCase()]
          );
        }
        rawDb.run(
          `INSERT OR REPLACE INTO cost_basis_overrides
           (holding_key, display_name, symbol, isin, broker, average_price, csv_qty, csv_current_price, source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.holdingKey.trim().toLowerCase(),
            item.displayName.trim(),
            item.symbol?.trim().toUpperCase() || null,
            item.isin?.trim().toUpperCase() || null,
            item.broker?.trim() || null,
            item.averagePrice,
            item.csvQty ?? null,
            item.csvCurrentPrice ?? null,
            item.source,
            item.updatedAt
          ]
        );
      }
    });
  }

  deleteCostOverride(holdingKey: string): void {
    this.db.run('DELETE FROM cost_basis_overrides WHERE holding_key = ?', [holdingKey.trim().toLowerCase()]);
  }

  // --- Insurance Policies & Documents ---
  getInsurancePolicies(isDemo: boolean): InsurancePolicy[] {
    const rows = this.db.all<{
      id: number;
      category: InsurancePolicy['category'];
      insurer: string;
      plan_name: string;
      sum_assured: number;
      annual_premium: number;
      renewal_date: string;
      payment_term: string;
      notes: string;
    }>(
      `SELECT id, category, insurer, plan_name, sum_assured, annual_premium, renewal_date, payment_term, notes
       FROM insurance_policies
       WHERE is_demo = ?
       ORDER BY id ASC`,
      [isDemo ? 1 : 0]
    );

    const docRows = this.db.all<{
      id: number;
      policy_id: number;
      doc_type: InsuranceDocumentType;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      doc_date: string;
      notes: string;
      uploaded_at: string;
    }>(
      `SELECT d.id, d.policy_id, d.doc_type, d.file_name, d.mime_type, d.size_bytes, d.doc_date, d.notes, d.uploaded_at
       FROM insurance_documents d
       INNER JOIN insurance_policies p ON p.id = d.policy_id
       WHERE p.is_demo = ?
       ORDER BY CASE d.doc_type WHEN 'policy' THEN 0 ELSE 1 END, d.doc_date DESC, d.uploaded_at DESC`,
      [isDemo ? 1 : 0]
    );

    const docsByPolicy = new Map<number, InsuranceDocument[]>();
    for (const d of docRows) {
      const list = docsByPolicy.get(d.policy_id) || [];
      list.push({
        id: d.id,
        policyId: d.policy_id,
        docType: d.doc_type === 'renewal' ? 'renewal' : 'policy',
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: Number(d.size_bytes ?? 0),
        docDate: d.doc_date || '',
        notes: d.notes || '',
        uploadedAt: d.uploaded_at
      });
      docsByPolicy.set(d.policy_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      insurer: r.insurer,
      planName: r.plan_name,
      sumAssured: Number(r.sum_assured ?? 0),
      annualPremium: Number(r.annual_premium ?? 0),
      renewalDate: r.renewal_date || '',
      paymentTerm: r.payment_term || '',
      notes: r.notes || '',
      documents: docsByPolicy.get(r.id) || []
    }));
  }

  saveInsurancePolicy(isDemo: boolean, policy: InsurancePolicy): InsurancePolicy {
    const demoFlag = isDemo ? 1 : 0;
    if (policy.id) {
      this.db.run(
        `UPDATE insurance_policies
         SET category = ?, insurer = ?, plan_name = ?, sum_assured = ?, annual_premium = ?, renewal_date = ?, payment_term = ?, notes = ?
         WHERE id = ? AND is_demo = ?`,
        [
          policy.category,
          policy.insurer.trim(),
          policy.planName.trim(),
          Number(policy.sumAssured) || 0,
          Number(policy.annualPremium) || 0,
          policy.renewalDate.trim(),
          policy.paymentTerm.trim(),
          policy.notes.trim(),
          policy.id,
          demoFlag
        ]
      );
      return policy;
    }

    this.db.run(
      `INSERT INTO insurance_policies (is_demo, category, insurer, plan_name, sum_assured, annual_premium, renewal_date, payment_term, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        demoFlag,
        policy.category,
        policy.insurer.trim(),
        policy.planName.trim(),
        Number(policy.sumAssured) || 0,
        Number(policy.annualPremium) || 0,
        policy.renewalDate.trim(),
        policy.paymentTerm.trim(),
        policy.notes.trim()
      ]
    );
    return { ...policy, id: this.db.getLastInsertId(), documents: [] };
  }

  deleteInsurancePolicy(id: number): string[] {
    const docPaths = this.db
      .all<{ stored_rel_path: string }>('SELECT stored_rel_path FROM insurance_documents WHERE policy_id = ?', [id])
      .map((r) => r.stored_rel_path);
    this.db.execBatch((rawDb) => {
      rawDb.run('DELETE FROM insurance_documents WHERE policy_id = ?', [id]);
      rawDb.run('DELETE FROM insurance_policies WHERE id = ?', [id]);
    });
    return docPaths;
  }

  addInsuranceDocument(record: {
    policyId: number;
    docType: InsuranceDocumentType;
    fileName: string;
    storedRelPath: string;
    mimeType: string;
    sizeBytes: number;
    docDate?: string;
    notes?: string;
    uploadedAt?: string;
  }): InsuranceDocument {
    const uploadedAt = record.uploadedAt || new Date().toISOString();
    this.db.run(
      `INSERT INTO insurance_documents
       (policy_id, doc_type, file_name, stored_rel_path, mime_type, size_bytes, doc_date, notes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.policyId,
        record.docType,
        record.fileName.trim(),
        record.storedRelPath,
        record.mimeType,
        record.sizeBytes,
        (record.docDate || '').trim(),
        (record.notes || '').trim(),
        uploadedAt
      ]
    );
    return {
      id: this.db.getLastInsertId(),
      policyId: record.policyId,
      docType: record.docType,
      fileName: record.fileName.trim(),
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      docDate: (record.docDate || '').trim(),
      notes: (record.notes || '').trim(),
      uploadedAt
    };
  }

  getInsuranceDocumentWithPath(docId: number): { doc: InsuranceDocument; storedRelPath: string } | null {
    const r = this.db.get<{
      id: number;
      policy_id: number;
      doc_type: InsuranceDocumentType;
      file_name: string;
      stored_rel_path: string;
      mime_type: string;
      size_bytes: number;
      doc_date: string;
      notes: string;
      uploaded_at: string;
    }>(
      `SELECT id, policy_id, doc_type, file_name, stored_rel_path, mime_type, size_bytes, doc_date, notes, uploaded_at
       FROM insurance_documents
       WHERE id = ?`,
      [docId]
    );
    if (!r) return null;
    return {
      storedRelPath: r.stored_rel_path,
      doc: {
        id: r.id,
        policyId: r.policy_id,
        docType: r.doc_type === 'renewal' ? 'renewal' : 'policy',
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes ?? 0),
        docDate: r.doc_date || '',
        notes: r.notes || '',
        uploadedAt: r.uploaded_at
      }
    };
  }

  deleteInsuranceDocument(docId: number): string | null {
    const existing = this.db.get<{ stored_rel_path: string }>(
      'SELECT stored_rel_path FROM insurance_documents WHERE id = ?',
      [docId]
    );
    if (!existing) return null;
    this.db.run('DELETE FROM insurance_documents WHERE id = ?', [docId]);
    return existing.stored_rel_path;
  }

  // --- AI Reports & Chat ---
  saveAIReport(report: Omit<AIReportRecord, 'id'>): AIReportRecord {
    this.db.run(
      `INSERT INTO ai_reports (is_demo, provider, model, created_at, title, markdown)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [report.isDemo ? 1 : 0, report.provider, report.model, report.createdAt, report.title, report.markdown]
    );
    const id = this.db.getLastInsertId();
    return { ...report, id };
  }

  getAIReports(isDemo: boolean, limit = 25): AIReportRecord[] {
    const rows = this.db.all<{
      id: number;
      is_demo: number;
      provider: AIReportRecord['provider'];
      model: string;
      created_at: string;
      title: string;
      markdown: string;
    }>(
      `SELECT id, is_demo, provider, model, created_at, title, markdown
       FROM ai_reports
       WHERE is_demo = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [isDemo ? 1 : 0, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      isDemo: r.is_demo === 1,
      provider: r.provider,
      model: r.model,
      createdAt: r.created_at,
      title: r.title,
      markdown: r.markdown
    }));
  }

  addChatMessage(isDemo: boolean, msg: Omit<AIChatMessage, 'id'>): AIChatMessage {
    this.db.run(
      'INSERT INTO ai_chat_messages (is_demo, role, content, created_at) VALUES (?, ?, ?, ?)',
      [isDemo ? 1 : 0, msg.role, msg.content, msg.createdAt]
    );
    return { ...msg, id: this.db.getLastInsertId() };
  }

  getChatMessages(isDemo: boolean, limit = 40): AIChatMessage[] {
    const rows = this.db.all<{
      id: number;
      role: 'user' | 'assistant';
      content: string;
      created_at: string;
    }>(
      `SELECT id, role, content, created_at
       FROM ai_chat_messages
       WHERE is_demo = ?
       ORDER BY id ASC
       LIMIT ?`,
      [isDemo ? 1 : 0, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at
    }));
  }

  clearChatMessages(isDemo: boolean): void {
    this.db.run('DELETE FROM ai_chat_messages WHERE is_demo = ?', [isDemo ? 1 : 0]);
  }

  wipeAllData(): void {
    this.db.execBatch((rawDb) => {
      rawDb.run('DELETE FROM app_meta');
      rawDb.run('DELETE FROM broker_status');
      rawDb.run('DELETE FROM snapshots');
      rawDb.run('DELETE FROM alerts');
      rawDb.run('DELETE FROM sip_baselines');
      rawDb.run('DELETE FROM symbol_aliases');
      rawDb.run('DELETE FROM cost_basis_overrides');
      rawDb.run('DELETE FROM insurance_documents');
      rawDb.run('DELETE FROM insurance_policies');
      rawDb.run('DELETE FROM ai_reports');
      rawDb.run('DELETE FROM ai_chat_messages');
    });
  }
}
