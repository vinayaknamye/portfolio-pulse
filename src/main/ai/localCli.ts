import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { LocalCliDetectionInfo, LocalCliToolId } from '@shared/types';
import { LOCAL_CLI_PRESETS } from '@shared/constants';
import type { LLMAttachment, LLMChatTurn, ProviderModelInfo } from './providers';

export interface CliExecOptions {
  command: string;
  args: string[];
  stdin?: string;
  /** Keep stdin open after writing until a stdout line satisfies this predicate (used for NDJSON stream-json CLIs like agy). */
  closeStdinWhen?: (stdoutSoFar: string) => boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CliExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export type CliExecFn = (opts: CliExecOptions) => Promise<CliExecResult>;

const LOCAL_CLI_TOOL_ORDER: LocalCliToolId[] = ['agy', 'gemini', 'codex', 'claude'];
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const DEFAULT_COMPLETION_TIMEOUT_MS = 180_000;
const MODEL_LIST_TIMEOUT_MS = 10_000;

const CLI_STDIN_INSTRUCTION =
  'Follow the instructions and answer using the full context provided on standard input. Respond directly with only your final answer; do not invoke external tools, modify files, or run shell commands.';

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function compareVersionDesc(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function safeReaddirNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds an augmented PATH that includes common user/package-manager binary directories
 * missing from Finder/Spotlight-launched macOS apps (Homebrew, nvm, fnm, volta, ~/.local/bin, etc.).
 */
export function buildAugmentedPath(opts?: {
  currentPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  prependDir?: string;
}): string {
  const platform = opts?.platform ?? process.platform;
  const env = opts?.env ?? process.env;
  const home = opts?.homeDir ?? os.homedir();
  const sep = platform === 'win32' ? ';' : ':';
  const existing = (opts?.currentPath ?? env.PATH ?? env.Path ?? '')
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean);

  const extraDirs: string[] = [];
  if (opts?.prependDir) {
    extraDirs.push(opts.prependDir);
  }

  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    extraDirs.push(
      path.join(home, '.local', 'bin'),
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.volta', 'bin'),
      path.join(localAppData, 'Volta', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(programFiles, 'nodejs')
    );
  } else {
    extraDirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local'),
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      path.join(home, '.volta', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.yarn', 'bin'),
      path.join(home, '.pnpm'),
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.asdf', 'shims'),
      path.join(home, '.mise', 'shims'),
      path.join(home, 'bin')
    );

    // Discover nvm-managed Node bin directories (newest version first)
    const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
    const nvmVersions = safeReaddirNames(nvmVersionsDir).sort(compareVersionDesc);
    for (const ver of nvmVersions) {
      extraDirs.push(path.join(nvmVersionsDir, ver, 'bin'));
    }

    // Discover fnm-managed Node bin directories (newest version first)
    const fnmVersionsDir = path.join(home, '.fnm', 'node-versions');
    const fnmVersions = safeReaddirNames(fnmVersionsDir).sort(compareVersionDesc);
    for (const ver of fnmVersions) {
      extraDirs.push(path.join(fnmVersionsDir, ver, 'installation', 'bin'));
    }
  }

  const seen = new Set<string>();
  const combined: string[] = [];
  for (const dir of [...(opts?.prependDir ? [opts.prependDir] : []), ...existing, ...extraDirs]) {
    if (!dir) continue;
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(dir);
  }
  return combined.join(sep);
}

function expandTilde(filePath: string, homeDir = os.homedir()): string {
  if (filePath === '~') return homeDir;
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(homeDir, filePath.slice(2));
  }
  return filePath;
}

export function resolveCliBinary(
  tool: LocalCliToolId,
  customBinaryPath?: string,
  opts?: {
    currentPath?: string;
    homeDir?: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  }
): string | null {
  const platform = opts?.platform ?? process.platform;
  const homeDir = opts?.homeDir ?? os.homedir();
  const sep = platform === 'win32' ? ';' : ':';
  const preset = LOCAL_CLI_PRESETS[tool];
  const candidateName = (customBinaryPath || '').trim() || preset.command;
  const expanded = expandTilde(candidateName, homeDir);

  // If user specified an explicit path (absolute or containing separator), check directly
  if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
    if (isExecutableFile(expanded, platform)) return expanded;
    if (platform === 'win32') {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        if (isExecutableFile(`${expanded}${ext}`, platform)) return `${expanded}${ext}`;
      }
    }
    return null;
  }

  const searchPath = buildAugmentedPath({
    currentPath: opts?.currentPath,
    homeDir,
    platform,
    env: opts?.env
  });
  const dirs = searchPath.split(sep).filter(Boolean);
  const names =
    platform === 'win32'
      ? [expanded, `${expanded}.exe`, `${expanded}.cmd`, `${expanded}.bat`]
      : [expanded];

  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (isExecutableFile(full, platform)) {
        return full;
      }
    }
  }
  return null;
}

export function detectLocalCliTools(opts?: {
  currentPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): LocalCliDetectionInfo[] {
  return LOCAL_CLI_TOOL_ORDER.map((id) => {
    const preset = LOCAL_CLI_PRESETS[id];
    const resolvedPath = resolveCliBinary(id, undefined, opts);
    return {
      id,
      label: preset.label,
      command: preset.command,
      installed: Boolean(resolvedPath),
      resolvedPath
    };
  });
}

export const defaultCliExec: CliExecFn = (opts) =>
  new Promise((resolve, reject) => {
    const isWinCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(opts.command);
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: isWinCmd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let stdinClosed = false;

    const closeStdinSafely = () => {
      if (stdinClosed) return;
      stdinClosed = true;
      try {
        child.stdin?.end();
      } catch {
        // Ignore broken pipe if child already exited
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      closeStdinSafely();
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already exited
          }
        }, 2500);
      } catch {
        // Ignore kill error
      }
    }, opts.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes < MAX_CAPTURE_BYTES) {
        const str = chunk.toString('utf-8');
        stdout += str;
        stdoutBytes += chunk.length;
      }
      if (!stdinClosed && opts.closeStdinWhen && opts.closeStdinWhen(stdout)) {
        closeStdinSafely();
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_CAPTURE_BYTES) {
        const str = chunk.toString('utf-8');
        stderr += str;
        stderrBytes += chunk.length;
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, exitCode: code, timedOut });
      }
    });

    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
    }
    if (!opts.closeStdinWhen) {
      closeStdinSafely();
    }
  });

function formatCliAttachment(att: LLMAttachment): string {
  const body = (att.extractedText || '').trim();
  if (body) {
    return `--- Attached File: ${att.fileName} (${att.mimeType}) ---\n${body}\n--- End of ${att.fileName} ---`;
  }
  return `[Attached File: ${att.fileName} (${att.mimeType}) — binary image/scanned file with no extracted plain text; local CLI mode receives text context only.]`;
}

export function buildLocalCliPrompt(systemPrompt: string, messages: LLMChatTurn[]): string {
  const sections: string[] = [];

  if (systemPrompt.trim()) {
    sections.push(`<system_instructions>\n${systemPrompt.trim()}\n</system_instructions>`);
  }

  if (messages.length === 1 && messages[0].role === 'user') {
    const m = messages[0];
    const parts: string[] = [];
    for (const att of m.attachments || []) {
      parts.push(formatCliAttachment(att));
    }
    parts.push(m.content);
    sections.push(parts.join('\n\n'));
  } else {
    const turns = messages.map((m) => {
      const roleLabel = m.role === 'assistant' ? 'Assistant' : 'User';
      const parts: string[] = [];
      for (const att of m.attachments || []) {
        parts.push(formatCliAttachment(att));
      }
      parts.push(m.content);
      return `${roleLabel}:\n${parts.join('\n\n')}`;
    });
    sections.push(
      `<conversation>\n${turns.join('\n\n---\n\n')}\n</conversation>\n\nRespond to the latest User message above.`
    );
  }

  return sections.join('\n\n');
}

function tryExtractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripAnsi(raw).trim();
  if (!cleaned) return null;

  // 1. Direct JSON payload
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to multi-line scanning
  }

  // 2. Scan lines from bottom up (CLIs often print warnings before a single-line JSON envelope)
  const lines = cleaned.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep scanning
    }
  }

  // 3. Fallback: try slicing from last top-level '{' block to last '}'
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace > 0) {
    let idx = cleaned.indexOf('{');
    while (idx !== -1 && idx < lastBrace) {
      const slice = cleaned.slice(idx, lastBrace + 1);
      try {
        const parsed = JSON.parse(slice) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try next '{'
      }
      idx = cleaned.indexOf('{', idx + 1);
    }
  }

  return null;
}

function parseAgyStreamJson(cleaned: string): { text: string; errorMessage?: string } | null {
  const lines = cleaned.split(/\r?\n/);
  let foundEvent = false;
  let resultResponse = '';
  let resultError: string | undefined;
  let resultStatus = '';
  const deltas: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    const evt = typeof obj.event === 'string' ? obj.event.toLowerCase() : '';
    if (!evt) continue;
    foundEvent = true;

    if (evt === 'result') {
      const payload =
        obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)
          ? (obj.result as Record<string, unknown>)
          : obj;
      if (typeof payload.response === 'string' && payload.response.trim()) {
        resultResponse = payload.response.trim();
      }
      if (typeof payload.error === 'string' && payload.error.trim()) {
        resultError = payload.error.trim();
      }
      if (typeof payload.status === 'string') {
        resultStatus = payload.status.toUpperCase();
      }
    } else if (evt === 'error') {
      const msg =
        (typeof obj.error === 'string' && obj.error.trim()) ||
        (typeof obj.message === 'string' && obj.message.trim()) ||
        undefined;
      if (msg) resultError = msg;
    } else if (evt === 'text_delta' || evt === 'delta' || evt === 'assistant_delta') {
      const chunk =
        (typeof obj.delta === 'string' && obj.delta) ||
        (typeof obj.text === 'string' && obj.text) ||
        (typeof obj.content === 'string' && obj.content) ||
        '';
      if (chunk) deltas.push(chunk);
    }
  }

  if (!foundEvent) return null;
  const finalText = resultResponse || deltas.join('').trim();
  if (resultError || (resultStatus && resultStatus !== 'SUCCESS' && resultStatus !== 'OK' && !finalText)) {
    return { text: '', errorMessage: resultError || `Antigravity CLI returned status ${resultStatus}` };
  }
  return { text: finalText };
}

function hasAgyTerminalEvent(stdoutSoFar: string): boolean {
  for (const rawLine of stdoutSoFar.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const obj = JSON.parse(trimmed) as { event?: unknown };
      if (obj.event === 'result' || obj.event === 'error') return true;
    } catch {
      // Incomplete or non-JSON line
    }
  }
  return false;
}

export function parseLocalCliOutput(
  tool: LocalCliToolId,
  stdout: string
): { text: string; errorMessage?: string } {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) return { text: '' };

  if (tool === 'agy') {
    const streamParsed = parseAgyStreamJson(cleaned);
    if (streamParsed) return streamParsed;
  }

  const json = tryExtractJsonObject(cleaned);
  if (json) {
    if (tool === 'agy') {
      const errStr = typeof json.error === 'string' && json.error.trim() ? json.error.trim() : undefined;
      const status = typeof json.status === 'string' ? json.status.toUpperCase() : '';
      const response = typeof json.response === 'string' ? json.response.trim() : '';
      if (errStr || (status && status !== 'SUCCESS' && status !== 'OK' && !response)) {
        return { text: '', errorMessage: errStr || `Antigravity CLI returned status ${status}` };
      }
      if (response) return { text: response };
    } else if (tool === 'gemini') {
      const errObj = json.error as { message?: string } | string | null | undefined;
      const errStr =
        typeof errObj === 'string'
          ? errObj.trim()
          : typeof errObj?.message === 'string'
          ? errObj.message.trim()
          : undefined;
      const response = typeof json.response === 'string' ? json.response.trim() : '';
      if (errStr && !response) return { text: '', errorMessage: errStr };
      if (response) return { text: response };
    } else if (tool === 'claude') {
      const isErr = Boolean(json.is_error);
      const result = typeof json.result === 'string' ? json.result.trim() : '';
      const errStr = typeof json.error === 'string' ? json.error.trim() : '';
      if (isErr) {
        return { text: '', errorMessage: result || errStr || 'Claude CLI reported an error.' };
      }
      if (result) return { text: result };
    } else if (tool === 'codex') {
      const response =
        (typeof json.response === 'string' && json.response.trim()) ||
        (typeof json.result === 'string' && json.result.trim()) ||
        (typeof json.message === 'string' && json.message.trim()) ||
        '';
      if (response) return { text: response };
    }
  }

  return { text: cleaned };
}

export function parseAgyModelsOutput(stdout: string): ProviderModelInfo[] {
  const cleaned = stripAnsi(stdout).trim();
  const discovered: ProviderModelInfo[] = [];
  const seen = new Set<string>(['default']);

  const addModel = (idRaw: string, displayRaw?: string) => {
    const id = idRaw
      .trim()
      .replace(/^[*•\-–✓✔→>]+\s*/, '')
      .replace(/\s+\[(?:default|current|active)\]\s*$/i, '')
      .replace(/\s+\((?:default|current|active)\)\s*$/i, '')
      .replace(/[,;]+$/, '')
      .trim();
    if (!id || id.length < 3 || id.length > 80) return;
    if (id.endsWith(':') || /:\s/.test(id)) return;
    if (!/^[a-z0-9][a-z0-9 ._:/()+-]*$/i.test(id)) return;
    // Ignore table headers, diagnostic lines, or generic prose
    if (
      /^(model|models|id|name|available|available models|default|alias|aliases|description|status|provider|usage|error|warning|note|tip)$/i.test(
        id
      )
    ) {
      return;
    }
    if (/^(available\s+models|showing\s+\d+|current\s+model|total\s+\d+|run\s+|use\s+--|failed\s+to|error\b|warning\b|invalid\s+model)/i.test(id)) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    discovered.push({ id, displayName: (displayRaw || '').trim() || id });
  };

  // Try JSON output first if CLI ever returns JSON
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown[] }).models)
      ? (parsed as { models: unknown[] }).models
      : null;
    if (list) {
      for (const item of list) {
        if (typeof item === 'string') {
          addModel(item);
        } else if (item && typeof item === 'object') {
          const obj = item as { id?: string; name?: string; displayName?: string; display_name?: string };
          const id = obj.id || obj.name;
          if (id) addModel(id, obj.displayName || obj.display_name || id);
        }
      }
      return [{ id: 'default', displayName: 'CLI Default (Recommended)' }, ...discovered];
    }
  } catch {
    // Standard human-readable CLI table/list output
  }

  // Slug pattern inside parens — only treat "(...)" as a separate model ID when it's an explicit hyphenated model slug
  // (e.g., "Gemini Flash (gemini-2.5-flash)"), NOT effort/tier suffixes like "(High)", "(Medium)", "(Low)", "(XHigh)".
  const SLUG_ID_RE = /^(?:gemini|claude|gpt|o[1-9]|llama|qwen|deepseek|mistral)[a-z0-9._:/-]*-[a-z0-9._:/-]+$/i;

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-=─┌┐└┘│+]+$/.test(line)) continue;
    // Skip Go/glog diagnostic lines (I1123 ..., E1123 ..., W1123 ...)
    if (/^[IWEF]\d{4}\s+\d{2}:\d{2}:\d{2}/.test(line)) continue;
    if (/^(?:ERROR:|WARN(?:ING)?:|INFO:|Available models:|Models:)/i.test(line)) continue;

    const cleanLine = line.replace(/^[*•\-–✓✔→>]+\s*/, '').trim();
    if (!cleanLine) continue;

    // Split multi-column tables on tabs or 2+ spaces (preserving single spaces in names like "Gemini Flash (High)")
    const cols = cleanLine.split(/\s{2,}|\t/).map((c) => c.trim()).filter(Boolean);
    const primary = cols[0];
    if (!primary) continue;

    // Pattern 1: "Display Name (explicit-slug-id)" -> extract slug ID only when parenthetical is a model slug
    const parenMatch = primary.match(/^([^()]{2,60}?)\s*\(([a-z0-9][a-z0-9._:/-]{2,60})\)$/i);
    if (parenMatch && SLUG_ID_RE.test(parenMatch[2])) {
      addModel(parenMatch[2], parenMatch[1]);
      continue;
    }

    // Pattern 2: Multi-column table where first column is a hyphenated slug (e.g. "gemini-2.5-pro   Frontier")
    if (cols.length >= 2 && SLUG_ID_RE.test(primary)) {
      const display = cols[1] && cols[1].length <= 60 ? cols[1] : primary;
      addModel(primary, display);
      continue;
    }

    // Pattern 3: Full human-readable model name (e.g. "Gemini Flash (High)", "Claude Sonnet (Medium)")
    addModel(primary);
  }

  return [{ id: 'default', displayName: 'CLI Default (Recommended)' }, ...discovered];
}

export async function listLocalCliModels(
  tool: LocalCliToolId,
  customBinaryPath?: string,
  execFn: CliExecFn = defaultCliExec,
  resolveBinaryFn: typeof resolveCliBinary = resolveCliBinary
): Promise<ProviderModelInfo[]> {
  const preset = LOCAL_CLI_PRESETS[tool];
  const resolved = resolveBinaryFn(tool, customBinaryPath);
  if (!resolved) {
    throw new Error(
      `${preset.label} ("${(customBinaryPath || '').trim() || preset.command}") was not found on this machine. Install it or specify its full path in Settings.`
    );
  }

  if (tool === 'agy') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-models-'));
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: buildAugmentedPath({ prependDir: path.dirname(resolved) }),
        NO_COLOR: '1',
        CI: '1'
      };
      const res = await execFn({
        command: resolved,
        args: ['models'],
        cwd: tmpDir,
        env,
        timeoutMs: MODEL_LIST_TIMEOUT_MS
      });
      if (res.exitCode === 0 && res.stdout.trim()) {
        return parseAgyModelsOutput(res.stdout);
      }
    } catch {
      // Fallback to CLI Default preset if `agy models` fails
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return preset.models.map((m) => ({ ...m }));
}

export interface LocalCliCompletionRequest {
  cliTool: LocalCliToolId;
  cliBinaryPath?: string;
  model: string;
  systemPrompt: string;
  messages: LLMChatTurn[];
  timeoutMs?: number;
}

export async function runLocalCliCompletion(
  req: LocalCliCompletionRequest,
  execFn: CliExecFn = defaultCliExec,
  resolveBinaryFn: typeof resolveCliBinary = resolveCliBinary
): Promise<{ text: string; model: string }> {
  const tool = req.cliTool || 'agy';
  const preset = LOCAL_CLI_PRESETS[tool];
  const resolved = resolveBinaryFn(tool, req.cliBinaryPath);
  if (!resolved) {
    throw new Error(
      `${preset.label} ("${(req.cliBinaryPath || '').trim() || preset.command}") was not found. Install it, sign in via Terminal, or set its executable path in Settings.`
    );
  }

  const normalizedModel = (req.model || 'default').trim();
  const explicitModel =
    normalizedModel && normalizedModel.toLowerCase() !== 'default' ? normalizedModel : undefined;
  const promptInput = buildLocalCliPrompt(
    `${req.systemPrompt}\n\nRespond directly with only your final answer; do not invoke external tools, modify files, or run shell commands.`,
    req.messages
  );
  const timeoutMs = req.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-run-'));
  const codexOutFile = path.join(tmpDir, 'codex-last-message.txt');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: buildAugmentedPath({ prependDir: path.dirname(resolved) }),
    NO_COLOR: '1',
    CI: '1'
  };

  try {
    const buildArgs = (opts?: { omitClaudeOptionalFlags?: boolean }): string[] => {
      if (tool === 'agy') {
        const args: string[] = [];
        if (explicitModel) args.push('--model', explicitModel);
        // Use NDJSON stream-json over stdin so full portfolio context is sent privately without argv limits
        // (agy's -p flag takes the prompt as an argument string and ignores plain-text stdin).
        args.push(
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--disable-slash-commands',
          '--sandbox',
          '--print-timeout',
          `${Math.max(30, Math.round(timeoutMs / 1000))}s`
        );
        return args;
      }

      if (tool === 'gemini') {
        const args: string[] = [];
        if (explicitModel) args.push('-m', explicitModel);
        args.push('--output-format', 'json', '-p', CLI_STDIN_INSTRUCTION);
        return args;
      }

      if (tool === 'codex') {
        const args: string[] = [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--output-last-message',
          codexOutFile
        ];
        if (explicitModel) args.push('--model', explicitModel);
        args.push('-');
        return args;
      }

      // claude
      const args: string[] = ['-p', '--output-format', 'json'];
      if (!opts?.omitClaudeOptionalFlags) {
        args.push('--no-session-persistence', '--tools', '');
      }
      if (explicitModel) args.push('--model', explicitModel);
      args.push(CLI_STDIN_INSTRUCTION);
      return args;
    };

    const stdinPayload =
      tool === 'agy'
        ? `${JSON.stringify({ event: 'user', message: { content: promptInput } })}\n`
        : promptInput;

    let result = await execFn({
      command: resolved,
      args: buildArgs(),
      stdin: stdinPayload,
      closeStdinWhen: tool === 'agy' ? hasAgyTerminalEvent : undefined,
      cwd: tmpDir,
      env,
      timeoutMs
    });

    // Retry cleanly if an older Claude CLI version rejects --tools or --no-session-persistence
    if (
      tool === 'claude' &&
      result.exitCode !== 0 &&
      /unknown option|unrecognized option/i.test(`${result.stderr}\n${result.stdout}`)
    ) {
      result = await execFn({
        command: resolved,
        args: buildArgs({ omitClaudeOptionalFlags: true }),
        stdin: promptInput,
        cwd: tmpDir,
        env,
        timeoutMs
      });
    }

    if (result.timedOut) {
      throw new Error(
        `${preset.label} timed out after ${Math.round(timeoutMs / 1000)}s. Verify your terminal CLI session works cleanly (${preset.loginHint}).`
      );
    }

    // For Codex, prefer the clean --output-last-message file when written
    if (tool === 'codex' && fs.existsSync(codexOutFile)) {
      const fileText = fs.readFileSync(codexOutFile, 'utf-8').trim();
      if (fileText && result.exitCode === 0) {
        return { text: fileText, model: `${tool}:${explicitModel || 'default'}` };
      }
    }

    const parsed = parseLocalCliOutput(tool, result.stdout);
    if (result.exitCode !== 0) {
      const errDetail =
        parsed.errorMessage ||
        stripAnsi(result.stderr || result.stdout)
          .trim()
          .slice(0, 320) ||
        `Exited with code ${result.exitCode}`;
      throw new Error(`${preset.label} error: ${errDetail}. (${preset.loginHint})`);
    }

    if (parsed.errorMessage) {
      throw new Error(`${preset.label} error: ${parsed.errorMessage}`);
    }

    if (!parsed.text) {
      const stderrNote = stripAnsi(result.stderr).trim().slice(0, 220);
      throw new Error(
        `${preset.label} returned an empty response${stderrNote ? `: ${stderrNote}` : ''}. (${preset.loginHint})`
      );
    }

    return {
      text: parsed.text,
      model: `${tool}:${explicitModel || 'default'}`
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
