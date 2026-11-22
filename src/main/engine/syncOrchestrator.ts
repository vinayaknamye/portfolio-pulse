import { AuditAlert, PortfolioSnapshot, SyncResult, UpstoxFetchPayload, UpstoxSyncState } from '@shared/types';
import { PortfolioRepository } from '@main/db/repository';
import { SecureStore } from '@main/db/secureStore';
import { IndmoneyAdapter } from '@main/mcp/indmoneyAdapter';
import { UpstoxAdapter } from '@main/mcp/upstoxAdapter';
import { ReauthRequiredError } from '@main/mcp/types';
import { reconcilePortfolio } from './reconciler';
import { buildNotificationSummary, runPortfolioAudit } from './auditor';
import { buildDemoPayloads } from '@main/demo/demoDataset';
import { buildPortfolioContextBlock, buildReviewPrompt, buildSystemPrompt } from '@main/ai/promptBuilder';
import { runLLMCompletion } from '@main/ai/providers';
import { AI_PROVIDER_PRESETS } from '@shared/constants';

export interface SyncDependencies {
  repo: PortfolioRepository;
  store: SecureStore;
  indmoney: IndmoneyAdapter;
  upstox: UpstoxAdapter;
  onNotify?: (title: string, body: string) => void;
  onStateChanged?: () => void;
}

export class SyncOrchestrator {
  private isSyncing = false;

  constructor(private readonly deps: SyncDependencies) {}

  async sync(options: { interactive: boolean; source: 'manual' | 'scheduled' }): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        alerts: [],
        upstoxState: 'not_linked',
        error: 'A portfolio sync is already in progress.'
      };
    }

    this.isSyncing = true;
    const { repo, indmoney, upstox } = this.deps;
    const isDemo = repo.isDemoMode();
    const profile = repo.getProfile();
    const aliases = repo.getAliases();
    const costOverrides = repo.getCostOverrides();

    try {
      let snapshot: PortfolioSnapshot;
      let upstoxState: UpstoxSyncState = 'not_linked';
      const nowIso = new Date().toISOString();

      if (isDemo) {
        const { indmoney: demoInd, upstox: demoUp } = buildDemoPayloads(0);
        upstoxState = 'live';
        snapshot = reconcilePortfolio({
          indmoney: demoInd,
          upstox: demoUp,
          upstoxState,
          aliases,
          costOverrides,
          profile,
          isDemo: true,
          fetchedAt: nowIso
        });
      } else {
        const statuses = repo.getBrokerStatuses();
        const shouldAttemptIndmoney =
          indmoney.hasStoredSession() ||
          statuses.indmoney.state === 'connected' ||
          statuses.indmoney.state === 'reauth_required';
        const shouldAttemptUpstox =
          upstox.hasStoredSession() ||
          statuses.upstox.state === 'connected' ||
          statuses.upstox.state === 'reauth_required';

        if (!shouldAttemptIndmoney && !shouldAttemptUpstox) {
          return {
            success: false,
            alerts: [],
            upstoxState: 'not_linked',
            error: 'No broker connected. Link INDmoney, Upstox, or both to sync.'
          };
        }

        // 1. INDmoney fetch (if linked)
        let indPayload = null;
        let indError: string | null = null;
        if (shouldAttemptIndmoney) {
          try {
            indPayload = await indmoney.fetchPortfolio({ interactive: options.interactive });
            repo.setBrokerStatus({
              broker: 'indmoney',
              state: 'connected',
              lastSyncAt: nowIso,
              lastError: null
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            indError = msg;
            const isReauth = err instanceof ReauthRequiredError;
            repo.setBrokerStatus({
              broker: 'indmoney',
              state: isReauth ? 'reauth_required' : 'error',
              lastSyncAt: statuses.indmoney.lastSyncAt,
              lastError: msg
            });
          }
        }

        // 2. Upstox fetch (if linked — supports standalone Upstox OR graceful partial sync with INDmoney)
        let upstoxPayload: UpstoxFetchPayload | null = null;
        let upstoxError: string | null = null;
        if (shouldAttemptUpstox) {
          try {
            upstoxPayload = await upstox.fetchPortfolio({ interactive: options.interactive });
            upstoxState = 'live';
            repo.setBrokerStatus({
              broker: 'upstox',
              state: 'connected',
              lastSyncAt: nowIso,
              lastError: null
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            upstoxError = msg;
            const isReauth = err instanceof ReauthRequiredError;
            upstoxState = 'stale_reauth_required';
            repo.setBrokerStatus({
              broker: 'upstox',
              state: isReauth ? 'reauth_required' : 'error',
              lastSyncAt: statuses.upstox.lastSyncAt,
              lastError: msg
            });
          }
        } else {
          upstoxState = 'not_linked';
        }

        // If EVERY attempted broker failed, abort cleanly without overwriting valid snapshots
        if (!indPayload && !upstoxPayload) {
          const combinedErr = [indError && `INDmoney: ${indError}`, upstoxError && `Upstox: ${upstoxError}`]
            .filter(Boolean)
            .join(' · ');

          if (profile.enableNotifications && options.source === 'scheduled') {
            this.deps.onNotify?.(
              'Portfolio Pulse · Sign-In Needed',
              'Broker session expired — click to reconnect and run today’s sync.'
            );
          }

          this.deps.onStateChanged?.();
          return {
            success: false,
            alerts: [],
            upstoxState,
            error: combinedErr || 'Unable to sync from linked brokers.'
          };
        }

        const previousCostBasis =
          upstoxState === 'stale_reauth_required' ? repo.getLastLiveUpstoxCostBasis(false) : [];

        snapshot = reconcilePortfolio({
          indmoney: indPayload,
          upstox: upstoxPayload,
          upstoxState,
          previousCostBasis,
          aliases,
          costOverrides,
          profile,
          isDemo: false,
          fetchedAt: nowIso
        });
      }

      const previousSnapshot = repo.getPreviousSnapshot(isDemo, snapshot.snapshotDate);
      const snapshotId = repo.saveSnapshot(snapshot);
      snapshot.id = snapshotId;

      // Auto-seed SIP baselines on first sync so users immediately get drift monitoring
      repo.seedSipBaselinesIfEmpty(isDemo, snapshot);
      const sipBaselines = repo.getSipBaselines(isDemo);

      const alerts: AuditAlert[] = runPortfolioAudit({
        current: snapshot,
        previous: previousSnapshot,
        profile,
        sipBaselines
      });
      repo.replaceAlertsForSnapshot(isDemo, snapshotId, alerts);

      repo.setMeta('last_scheduled_sync_date', snapshot.snapshotDate);

      if (profile.enableNotifications && (options.source === 'scheduled' || upstoxState === 'stale_reauth_required')) {
        const notif = buildNotificationSummary(snapshot, alerts, previousSnapshot);
        this.deps.onNotify?.(notif.title, notif.body);
      }

      // Optional scheduled AI review (off by default — manual unless user opts into weekly/daily)
      if (options.source === 'scheduled' && !isDemo && profile.aiSchedule !== 'manual') {
        await this.maybeRunScheduledAIReview(snapshot, previousSnapshot, alerts);
      }

      this.deps.onStateChanged?.();
      return {
        success: true,
        snapshot,
        alerts,
        upstoxState
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private async maybeRunScheduledAIReview(
    snapshot: PortfolioSnapshot,
    previous: PortfolioSnapshot | null,
    alerts: AuditAlert[]
  ): Promise<void> {
    const { repo, store } = this.deps;
    const profile = repo.getProfile();
    const preset = AI_PROVIDER_PRESETS[profile.aiProvider];
    const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);
    if (preset.requiresKey && !apiKey) return;

    const existingReports = repo.getAIReports(false, 1);
    const lastReport = existingReports[0];
    if (lastReport) {
      const daysSince = (Date.now() - new Date(lastReport.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (profile.aiSchedule === 'daily' && daysSince < 0.8) return;
      if (profile.aiSchedule === 'weekly' && daysSince < 6.5) return;
    }

    try {
      const contextBlock = buildPortfolioContextBlock(
        snapshot,
        previous,
        alerts,
        profile,
        repo.getInsurancePolicies(false)
      );
      const completion = await runLLMCompletion({
        provider: profile.aiProvider,
        model: profile.aiModel,
        apiKey,
        baseUrl: profile.aiBaseUrl || undefined,
        systemPrompt: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildReviewPrompt(contextBlock) }]
      });

      repo.saveAIReport({
        isDemo: false,
        provider: completion.provider,
        model: completion.model,
        createdAt: new Date().toISOString(),
        title: `Scheduled Review (${snapshot.snapshotDate})`,
        markdown: completion.text
      });
    } catch {
      // Scheduled AI review failures should never break the deterministic sync
    }
  }
}
