import { Notification, powerMonitor } from 'electron';
import { PortfolioRepository } from '@main/db/repository';
import { SyncOrchestrator } from './syncOrchestrator';

function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseDailyMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 21 * 60 + 30;
  return Math.max(0, Math.min(23 * 60 + 59, h * 60 + m));
}

export class DailySyncScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: PortfolioRepository,
    private readonly orchestrator: SyncOrchestrator,
    private readonly onNotificationClick: () => void
  ) {}

  start(): void {
    this.stop();
    // Poll every 60 seconds — lightweight and resilient to system sleep/clock drift
    this.timer = setInterval(() => {
      void this.checkAndRunIfDue();
    }, 60_000);

    // Wake-from-sleep catch-up check
    try {
      powerMonitor.on('resume', () => {
        setTimeout(() => {
          void this.checkAndRunIfDue();
        }, 10_000);
      });
    } catch {
      // Ignore if powerMonitor unavailable in test env
    }

    // Initial catch-up check 15s after app boot
    setTimeout(() => {
      void this.checkAndRunIfDue();
    }, 15_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAndRunIfDue(): Promise<void> {
    const profile = this.repo.getProfile();
    if (!profile.enableDailySync) return;
    if (this.repo.isDemoMode()) return;

    const brokers = this.repo.getBrokerStatuses();
    if (brokers.indmoney.state === 'disconnected' && brokers.upstox.state === 'disconnected') return;

    const today = getTodayDateString();
    const lastSyncDate = this.repo.getMeta('last_scheduled_sync_date');
    if (lastSyncDate === today) return;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = parseDailyMinutes(profile.dailySyncTime || '21:30');

    if (nowMinutes >= targetMinutes) {
      await this.orchestrator.sync({ interactive: false, source: 'scheduled' });
    }
  }

  sendNativeNotification(title: string, body: string): void {
    try {
      if (!Notification.isSupported()) return;
      const notif = new Notification({
        title,
        body,
        silent: false
      });
      notif.on('click', () => {
        this.onNotificationClick();
      });
      notif.show();
    } catch {
      // Non-fatal if OS suppresses notifications
    }
  }
}
