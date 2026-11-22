import fs from 'fs';
import path from 'path';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function resolveWasmPath(): string {
  const candidates = [
    // Packaged Electron app.asar.unpacked location (checked first for packaged apps)
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return require.resolve('sql.js/dist/sql-wasm.wasm');
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const wasmPath = resolveWasmPath();
    sqlPromise = initSqlJs({
      locateFile: () => wasmPath,
      useOldExtensionFunctions: false
    });
  }
  return sqlPromise;
}

export class LocalDatabase {
  private db!: SqlJsDatabase;
  private readonly dbPath: string | null;

  private constructor(dbPath: string | null) {
    this.dbPath = dbPath;
  }

  static async open(dbPath: string | null): Promise<LocalDatabase> {
    const instance = new LocalDatabase(dbPath);
    const SQL = await getSql();

    if (dbPath && fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      instance.db = new SQL.Database(new Uint8Array(buf));
    } else {
      instance.db = new SQL.Database();
    }

    instance.runMigrations();
    instance.save();
    return instance;
  }

  private runMigrations(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broker_status (
        broker TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        snapshot_date TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        upstox_state TEXT NOT NULL,
        total_networth REAL NOT NULL,
        total_invested_adjusted REAL NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_demo_date
        ON snapshots(is_demo, snapshot_date, fetched_at);

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        is_demo INTEGER NOT NULL DEFAULT 0,
        snapshot_id INTEGER,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sip_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        fund_name TEXT NOT NULL,
        expected_amount REAL NOT NULL,
        expected_frequency TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(is_demo, fund_name)
      );

      CREATE TABLE IF NOT EXISTS symbol_aliases (
        indmoney_name TEXT PRIMARY KEY,
        upstox_symbol TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cost_basis_overrides (
        holding_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        symbol TEXT,
        isin TEXT,
        broker TEXT,
        average_price REAL NOT NULL,
        csv_qty REAL,
        csv_current_price REAL,
        source TEXT NOT NULL DEFAULT 'manual',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS insurance_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        insurer TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        sum_assured REAL NOT NULL DEFAULT 0,
        annual_premium REAL NOT NULL DEFAULT 0,
        renewal_date TEXT NOT NULL DEFAULT '',
        payment_term TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ai_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Additive column migration for existing v0.1.0 databases
    const overrideCols = new Set(
      this.all<{ name: string }>('PRAGMA table_info(cost_basis_overrides)').map((c) => c.name)
    );
    if (!overrideCols.has('csv_qty')) {
      this.db.run('ALTER TABLE cost_basis_overrides ADD COLUMN csv_qty REAL');
    }
    if (!overrideCols.has('csv_current_price')) {
      this.db.run('ALTER TABLE cost_basis_overrides ADD COLUMN csv_current_price REAL');
    }
  }

  save(): void {
    if (!this.dbPath) return;
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const data = this.db.export();
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.dbPath);
  }

  run(sql: string, params: Array<string | number | null> = []): void {
    this.db.run(sql, params);
    this.save();
  }

  execBatch(fn: (db: SqlJsDatabase) => void): void {
    fn(this.db);
    this.save();
  }

  all<T = Record<string, unknown>>(sql: string, params: Array<string | number | null> = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  get<T = Record<string, unknown>>(sql: string, params: Array<string | number | null> = []): T | null {
    const rows = this.all<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  getLastInsertId(): number {
    const row = this.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    return Number(row?.id ?? 0);
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
