import path from 'path';
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { LocalDatabase } from './db/database';
import { SecureStore } from './db/secureStore';
import { PortfolioRepository } from './db/repository';
import { IndmoneyAdapter } from './mcp/indmoneyAdapter';
import { UpstoxAdapter } from './mcp/upstoxAdapter';
import { SyncOrchestrator } from './engine/syncOrchestrator';
import { DailySyncScheduler } from './engine/scheduler';
import { buildAppState, registerIpcHandlers } from './ipc/handlers';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let localDb: LocalDatabase | null = null;
let schedulerRef: DailySyncScheduler | null = null;

function createTrayIcon(): Electron.NativeImage {
  // Clean 16x16 PNG data URL (emerald pulse circle) so Tray works reliably cross-platform without external file lookup
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <rect x="1" y="1" width="16" height="16" rx="4" fill="#10b981"/>
    <polyline points="3.5,10 6.5,10 8,5.5 10.5,12.5 12,8.5 14.5,8.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const img = nativeImage.createFromDataURL(dataUrl);
  return img.resize({ width: 16, height: 16 });
}

function showOrFocusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#070b14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'portfolio-pulse.sqlite');

  localDb = await LocalDatabase.open(dbPath);
  const store = new SecureStore(userDataDir);
  const repo = new PortfolioRepository(localDb);
  const indmoney = new IndmoneyAdapter(store);
  const upstox = new UpstoxAdapter(store);

  const ipcCtx = {
    repo,
    store,
    indmoney,
    upstox,
    orchestrator: null as unknown as SyncOrchestrator,
    scheduler: null as unknown as DailySyncScheduler,
    getWindow: () => mainWindow
  };

  const orchestrator = new SyncOrchestrator({
    repo,
    store,
    indmoney,
    upstox,
    onNotify: (title, body) => schedulerRef?.sendNativeNotification(title, body),
    onStateChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:stateUpdated', buildAppState(ipcCtx));
      }
    }
  });

  const scheduler = new DailySyncScheduler(repo, orchestrator, () => {
    showOrFocusWindow();
  });

  ipcCtx.orchestrator = orchestrator;
  ipcCtx.scheduler = scheduler;
  schedulerRef = scheduler;

  registerIpcHandlers(ipcCtx);
  createWindow();

  // Setup system tray for background daily refresh
  try {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Portfolio Pulse — Local-First Portfolio Tracker');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Portfolio Pulse', click: () => showOrFocusWindow() },
      {
        label: 'Sync Portfolio Now',
        click: () => {
          void orchestrator.sync({ interactive: false, source: 'manual' });
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Portfolio Pulse',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => showOrFocusWindow());
  } catch {
    tray = null;
  }

  scheduler.start();
}

app.whenReady().then(() => {
  void bootstrap();

  app.on('activate', () => {
    showOrFocusWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  schedulerRef?.stop();
  localDb?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});
