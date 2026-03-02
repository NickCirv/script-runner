#!/usr/bin/env node
/**
 * script-runner — Beautiful interactive TUI for package.json scripts
 * Zero external dependencies. Node 18+ ES modules.
 */

import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import os from 'os';
import readline from 'readline';

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const ESC = '\x1b[';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[97m';
const BG_BLUE = '\x1b[44m';
const BG_DARK = '\x1b[48;5;236m';

const clr = (color, str) => `${color}${str}${RESET}`;
const bold = (str) => `${BOLD}${str}${RESET}`;
const dim = (str) => `${DIM}${str}${RESET}`;

const clearScreen = () => process.stdout.write('\x1b[2J\x1b[H');
const clearLine = () => process.stdout.write('\r\x1b[K');
const moveTo = (row, col) => process.stdout.write(`\x1b[${row};${col}H`);
const hideCursor = () => process.stdout.write('\x1b[?25l');
const showCursor = () => process.stdout.write('\x1b[?25h');
const saveCursor = () => process.stdout.write('\x1b[s');
const restoreCursor = () => process.stdout.write('\x1b[u');

// ─── Package manager detection ───────────────────────────────────────────────
function detectPackageManager(cwd) {
  const checks = [
    { file: 'bun.lockb', pm: 'bun' },
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'package-lock.json', pm: 'npm' },
  ];
  for (const { file, pm } of checks) {
    if (fs.existsSync(path.join(cwd, file))) return pm;
  }
  return 'npm';
}

// ─── package.json loader ─────────────────────────────────────────────────────
function loadPackageJson(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(clr(RED, `✗ No package.json found in ${cwd}`));
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    console.error(clr(RED, `✗ Failed to parse package.json: ${e.message}`));
    process.exit(1);
  }
}

// ─── Metadata persistence ────────────────────────────────────────────────────
function getMetaPath(cwd) {
  const pkgName = loadPackageJson(cwd).name || path.basename(cwd);
  const safe = pkgName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.homedir(), `.script-runner-${safe}.json`);
}

function loadMeta(cwd) {
  const metaPath = getMetaPath(cwd);
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveMeta(cwd, meta) {
  const metaPath = getMetaPath(cwd);
  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // silently fail — metadata is non-critical
  }
}

function recordRun(cwd, scriptName, exitCode, durationMs) {
  const meta = loadMeta(cwd);
  if (!meta[scriptName]) meta[scriptName] = { count: 0 };
  meta[scriptName].lastRun = Date.now();
  meta[scriptName].lastDuration = durationMs;
  meta[scriptName].lastExitCode = exitCode;
  meta[scriptName].count = (meta[scriptName].count || 0) + 1;
  if (!meta[scriptName].history) meta[scriptName].history = [];
  meta[scriptName].history.unshift({ ts: Date.now(), exitCode, durationMs });
  if (meta[scriptName].history.length > 20) meta[scriptName].history.length = 20;
  saveMeta(cwd, meta);
}

// ─── Fuzzy search ────────────────────────────────────────────────────────────
function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Time formatting ─────────────────────────────────────────────────────────
function relativeTime(ts) {
  if (!ts) return '—  never run';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(exitCode) {
  if (exitCode === undefined || exitCode === null) return dim('—');
  return exitCode === 0 ? clr(GREEN, '✅') : clr(RED, '❌');
}

// ─── Terminal width helper ────────────────────────────────────────────────────
function termWidth() {
  return process.stdout.columns || 80;
}

// ─── Pad / truncate to width (strip ANSI for length calc) ────────────────────
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padEnd(str, width) {
  const visible = stripAnsi(str).length;
  const pad = Math.max(0, width - visible);
  return str + ' '.repeat(pad);
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

// ─── Run a single script (streaming) ─────────────────────────────────────────
function runScript(pm, scriptName, cwd) {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = ['run', scriptName];
    const child = spawn(pm, args, { cwd, stdio: 'inherit', shell: false });

    child.on('exit', (code) => {
      const duration = Date.now() - start;
      recordRun(cwd, scriptName, code ?? 1, duration);
      resolve({ scriptName, exitCode: code ?? 1, duration });
    });

    child.on('error', (err) => {
      const duration = Date.now() - start;
      recordRun(cwd, scriptName, 1, duration);
      console.error(clr(RED, `\n✗ Failed to start "${scriptName}": ${err.message}`));
      resolve({ scriptName, exitCode: 1, duration });
    });
  });
}

// ─── Parallel execution ───────────────────────────────────────────────────────
async function runParallel(pm, scriptNames, cwd) {
  const width = termWidth();
  const sep = clr(DIM, '─'.repeat(width));

  console.log(`\n${bold(`Running ${scriptNames.length} scripts in parallel...`)}\n`);

  const prefixLen = Math.max(...scriptNames.map((s) => s.length)) + 2;
  const results = {};

  const processes = scriptNames.map((name) => {
    return new Promise((resolve) => {
      const start = Date.now();
      const args = ['run', name];
      const prefix = clr(CYAN, `[${name.padEnd(prefixLen - 2)}]`);

      const child = spawn(pm, args, { cwd, stdio: 'pipe', shell: false });

      child.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line, i) => {
          if (line || i < lines.length - 1) {
            process.stdout.write(`${prefix} ${line}\n`);
          }
        });
      });

      child.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line, i) => {
          if (line || i < lines.length - 1) {
            process.stdout.write(`${prefix} ${clr(DIM, line)}\n`);
          }
        });
      });

      child.on('exit', (code) => {
        const duration = Date.now() - start;
        recordRun(cwd, name, code ?? 1, duration);
        results[name] = { exitCode: code ?? 1, duration };
        resolve();
      });

      child.on('error', (err) => {
        const duration = Date.now() - start;
        recordRun(cwd, name, 1, duration);
        console.error(`${prefix} ${clr(RED, `✗ ${err.message}`)}`);
        results[name] = { exitCode: 1, duration };
        resolve();
      });
    });
  });

  await Promise.all(processes);

  console.log(`\n${sep}`);
  for (const name of scriptNames) {
    const r = results[name];
    const icon = r.exitCode === 0 ? clr(GREEN, 'DONE   ') : clr(RED, 'FAILED ');
    const detail = r.exitCode !== 0 ? ` (exit ${r.exitCode}, ${fmtDuration(r.duration)})` : ` (${fmtDuration(r.duration)})`;
    console.log(`${clr(CYAN, `[${name.padEnd(prefixLen - 2)}]`)} ${icon}${dim(detail)}`);
  }
  console.log(sep);
}

// ─── Sequential execution ─────────────────────────────────────────────────────
async function runSequential(pm, scriptNames, cwd) {
  for (const name of scriptNames) {
    const width = termWidth();
    console.log(`\n${clr(CYAN, bold(`▶ Running: ${name}`))}`);
    console.log(clr(DIM, '─'.repeat(Math.min(40, width))));
    const result = await runScript(pm, name, cwd);
    if (result.exitCode !== 0) {
      console.log(`\n${clr(RED, `✗ "${name}" exited with code ${result.exitCode}`)} ${dim(`(${fmtDuration(result.duration)})`)}`);
      process.exit(result.exitCode);
    } else {
      console.log(`\n${clr(GREEN, `✓ "${name}" completed`)} ${dim(`(${fmtDuration(result.duration)})`)}`);
    }
  }
}

// ─── --list mode ──────────────────────────────────────────────────────────────
function printList(scripts, meta, pm, pkgName) {
  const width = termWidth();
  console.log(`\n${bold(`📦 Script Runner — ${pkgName}`)}`);
  console.log(clr(DIM, '─'.repeat(Math.min(60, width))));
  console.log(`${dim('Package manager:')} ${clr(CYAN, pm)} ${dim('|')} ${Object.keys(scripts).length} scripts\n`);

  const nameWidth = Math.max(...Object.keys(scripts).map((s) => s.length), 4) + 2;
  const cmdWidth = Math.min(40, Math.floor((width - nameWidth - 30) / 1));

  for (const [name, cmd] of Object.entries(scripts)) {
    const m = meta[name];
    const icon = m ? statusIcon(m.lastExitCode) : dim('—');
    const when = m?.lastRun ? relativeTime(m.lastRun) : '—  never run';
    const dur = m?.lastDuration ? `(${fmtDuration(m.lastDuration)})` : '';
    const failed = m?.lastExitCode !== undefined && m.lastExitCode !== 0 ? ', FAILED' : '';
    const detail = dur ? dim(`${dur}${failed}`) : '';

    const namePart = clr(WHITE, name.padEnd(nameWidth));
    const cmdPart = dim(truncate(`"${cmd}"`, cmdWidth).padEnd(cmdWidth + 2));
    const whenPart = dim(when.padEnd(14));

    console.log(`  ${icon} ${namePart} ${cmdPart} ${whenPart} ${detail}`);
  }
  console.log();
}

// ─── --history mode ───────────────────────────────────────────────────────────
function printHistory(scripts, meta, pkgName) {
  const width = termWidth();
  console.log(`\n${bold(`📦 Run History — ${pkgName}`)}`);
  console.log(clr(DIM, '─'.repeat(Math.min(60, width))));

  // Flatten all history entries, sorted by ts desc
  const entries = [];
  for (const [name, m] of Object.entries(meta)) {
    if (!scripts[name]) continue;
    for (const h of m.history || []) {
      entries.push({ name, ...h });
    }
  }

  if (entries.length === 0) {
    console.log(dim('\n  No run history yet.\n'));
    return;
  }

  entries.sort((a, b) => b.ts - a.ts);
  const show = entries.slice(0, 30);

  for (const e of show) {
    const icon = e.exitCode === 0 ? clr(GREEN, '✅') : clr(RED, '❌');
    const date = new Date(e.ts).toLocaleString();
    const dur = fmtDuration(e.durationMs);
    console.log(`  ${icon} ${clr(WHITE, e.name.padEnd(20))} ${dim(date.padEnd(22))} ${dim(dur)}`);
  }
  console.log();
}

// ─── --stats mode ─────────────────────────────────────────────────────────────
function printStats(scripts, meta, pkgName) {
  const width = termWidth();
  console.log(`\n${bold(`📦 Script Stats — ${pkgName}`)}`);
  console.log(clr(DIM, '─'.repeat(Math.min(60, width))));

  const rows = [];
  for (const [name] of Object.entries(scripts)) {
    const m = meta[name];
    if (!m || !m.count) continue;
    const total = m.count;
    const successCount = (m.history || []).filter((h) => h.exitCode === 0).length;
    const rate = m.history?.length ? Math.round((successCount / m.history.length) * 100) : 100;
    const avgDur = m.history?.length
      ? Math.round(m.history.reduce((s, h) => s + (h.durationMs || 0), 0) / m.history.length)
      : 0;
    rows.push({ name, total, rate, avgDur });
  }

  if (rows.length === 0) {
    console.log(dim('\n  No stats yet — run some scripts first.\n'));
    return;
  }

  rows.sort((a, b) => b.total - a.total);

  console.log();
  console.log(`  ${bold('Script'.padEnd(22))} ${bold('Runs'.padEnd(8))} ${bold('Success%'.padEnd(12))} ${bold('Avg Duration')}`);
  console.log(clr(DIM, `  ${'─'.repeat(54)}`));

  for (const r of rows) {
    const rateColor = r.rate >= 80 ? GREEN : r.rate >= 50 ? YELLOW : RED;
    console.log(
      `  ${clr(WHITE, r.name.padEnd(22))} ${dim(String(r.total).padEnd(8))} ${clr(rateColor, `${r.rate}%`.padEnd(12))} ${dim(fmtDuration(r.avgDur))}`
    );
  }
  console.log();
}

// ─── Interactive TUI ──────────────────────────────────────────────────────────
class TUI {
  constructor(scripts, meta, pm, pkgName, cwd) {
    this.scripts = Object.entries(scripts); // [[name, cmd], ...]
    this.meta = meta;
    this.pm = pm;
    this.pkgName = pkgName;
    this.cwd = cwd;

    this.cursor = 0;
    this.selected = new Set();
    this.searchQuery = '';
    this.inSearch = false;
    this.lastScript = null;

    // filtered view
    this.filtered = [...this.scripts];
  }

  get visibleItems() {
    return this.filtered;
  }

  applyFilter() {
    this.filtered = this.scripts.filter(([name]) => fuzzyMatch(this.searchQuery, name));
    this.cursor = Math.min(this.cursor, Math.max(0, this.filtered.length - 1));
  }

  render() {
    const width = termWidth();
    const lines = [];

    // Header
    lines.push('');
    lines.push(`${bold(clr(CYAN, `📦 Script Runner`))} ${clr(DIM, '—')} ${bold(clr(WHITE, this.pkgName))}`);
    lines.push(clr(DIM, '─'.repeat(Math.min(60, width))));
    lines.push(`${dim('Package manager:')} ${clr(CYAN, this.pm)} ${dim('|')} ${clr(WHITE, String(this.scripts.length))} ${dim('scripts found')}`);
    lines.push('');

    if (this.inSearch || this.searchQuery) {
      const prompt = this.inSearch ? clr(CYAN, '/') : clr(DIM, '/');
      lines.push(`  ${prompt} ${clr(YELLOW, this.searchQuery)}${this.inSearch ? clr(CYAN, '█') : ''}`);
      lines.push('');
    }

    if (this.filtered.length === 0) {
      lines.push(dim(`  No scripts match "${this.searchQuery}"`));
    }

    // name column width
    const nameWidth = Math.max(...this.scripts.map(([n]) => n.length), 4) + 2;
    const cmdMaxWidth = Math.min(36, Math.floor((width - nameWidth - 32) / 1));

    for (let i = 0; i < this.filtered.length; i++) {
      const [name, cmd] = this.filtered[i];
      const m = this.meta[name];
      const isActive = i === this.cursor;
      const isSelected = this.selected.has(name);

      const icon = m ? statusIcon(m.lastExitCode) : dim('—');
      const when = m?.lastRun ? relativeTime(m.lastRun) : '— never run';
      const dur = m?.lastDuration ? `(${fmtDuration(m.lastDuration)}` : '';
      const failed = m?.lastExitCode !== undefined && m.lastExitCode !== 0 ? ', FAILED)' : dur ? ')' : '';
      const durStr = dur ? dim(dur + failed) : '';

      const selectMark = isSelected ? clr(MAGENTA, '●') : ' ';
      const arrow = isActive ? clr(CYAN, '>') : ' ';

      const namePart = isActive
        ? bold(clr(WHITE, name.padEnd(nameWidth)))
        : clr(DIM, name.padEnd(nameWidth));

      const cmdStr = truncate(`"${cmd}"`, cmdMaxWidth);
      const cmdPart = isActive ? dim(cmdStr.padEnd(cmdMaxWidth + 2)) : dim(cmdStr.padEnd(cmdMaxWidth + 2));

      const whenColor = isActive ? WHITE : DIM;
      const whenPart = clr(DIM, when.padEnd(14));

      let line = `  ${arrow} ${selectMark} ${namePart} ${cmdPart} ${whenPart} ${durStr}`;

      if (isActive) {
        line = `${BG_DARK}${line}${RESET}`;
      }
      if (isSelected) {
        line = line.replace(name, `${MAGENTA}${name}${RESET}${isActive ? BG_DARK : ''}`);
      }

      lines.push(line);
    }

    lines.push('');
    if (this.selected.size > 0) {
      lines.push(clr(MAGENTA, `  ${this.selected.size} selected — Enter to run all in parallel`));
    }

    const hint = this.inSearch
      ? dim('  Esc to exit search | Enter to confirm')
      : dim('  ↑↓ navigate | Enter run | Space select | / search | R re-run | Q quit');

    lines.push(hint);
    lines.push('');

    return lines.join('\n');
  }

  redraw() {
    clearScreen();
    process.stdout.write(this.render());
  }

  async run() {
    hideCursor();
    clearScreen();
    this.redraw();

    return new Promise((resolve) => {
      const cleanup = () => {
        showCursor();
        clearScreen();
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
      };

      const handleData = async (data) => {
        const str = data.toString();

        // Ctrl+C
        if (str === '\x03') {
          cleanup();
          process.exit(0);
        }

        // Quit
        if (!this.inSearch && (str === 'q' || str === 'Q')) {
          cleanup();
          resolve({ action: 'quit' });
          return;
        }

        // Enter search mode
        if (!this.inSearch && str === '/') {
          this.inSearch = true;
          this.searchQuery = '';
          this.applyFilter();
          this.redraw();
          return;
        }

        // In search mode
        if (this.inSearch) {
          if (str === '\x1b' || str === '\x1b[') {
            // Escape — exit search
            this.inSearch = false;
            this.searchQuery = '';
            this.applyFilter();
            this.redraw();
            return;
          }
          if (str === '\r' || str === '\n') {
            this.inSearch = false;
            this.applyFilter();
            this.redraw();
            return;
          }
          if (str === '\x7f' || str === '\b') {
            this.searchQuery = this.searchQuery.slice(0, -1);
            this.applyFilter();
            this.redraw();
            return;
          }
          // Printable characters
          if (str.length === 1 && str >= ' ') {
            this.searchQuery += str;
            this.applyFilter();
            this.redraw();
            return;
          }
          return;
        }

        // Arrow up
        if (str === '\x1b[A') {
          this.cursor = Math.max(0, this.cursor - 1);
          this.redraw();
          return;
        }

        // Arrow down
        if (str === '\x1b[B') {
          this.cursor = Math.min(this.filtered.length - 1, this.cursor + 1);
          this.redraw();
          return;
        }

        // Space — toggle selection
        if (str === ' ') {
          if (this.filtered.length === 0) return;
          const [name] = this.filtered[this.cursor];
          if (this.selected.has(name)) {
            this.selected.delete(name);
          } else {
            this.selected.add(name);
          }
          this.redraw();
          return;
        }

        // R — re-run last
        if (str === 'r' || str === 'R') {
          if (this.lastScript) {
            cleanup();
            resolve({ action: 'run', scripts: [this.lastScript], parallel: false });
          }
          return;
        }

        // Enter — run
        if (str === '\r' || str === '\n') {
          if (this.filtered.length === 0) return;

          let toRun;
          let parallel = false;

          if (this.selected.size > 0) {
            toRun = [...this.selected];
            parallel = true;
          } else {
            const [name] = this.filtered[this.cursor];
            toRun = [name];
          }

          this.lastScript = toRun[toRun.length - 1];
          cleanup();
          resolve({ action: 'run', scripts: toRun, parallel });
        }
      };

      process.stdin.on('data', handleData);

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Handle terminal resize
      process.stdout.on('resize', () => {
        this.redraw();
      });
    });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  const pkg = loadPackageJson(cwd);
  const scripts = pkg.scripts || {};
  const pkgName = pkg.name || path.basename(cwd);
  const pm = detectPackageManager(cwd);
  const meta = loadMeta(cwd);

  if (Object.keys(scripts).length === 0) {
    console.log(clr(YELLOW, `\n⚠  No scripts found in package.json\n`));
    process.exit(0);
  }

  // ── Flags ──
  if (args.includes('--list') || args.includes('-l')) {
    printList(scripts, meta, pm, pkgName);
    return;
  }

  if (args.includes('--history') || args.includes('-h')) {
    printHistory(scripts, meta, pkgName);
    return;
  }

  if (args.includes('--stats') || args.includes('-s')) {
    printStats(scripts, meta, pkgName);
    return;
  }

  // ── Direct run ──
  const parallelFlag = args.includes('-p') || args.includes('--parallel');
  const scriptArgs = args.filter((a) => !a.startsWith('-'));

  if (scriptArgs.length > 0) {
    // Validate all scripts exist
    for (const name of scriptArgs) {
      if (!scripts[name]) {
        console.error(clr(RED, `✗ Script "${name}" not found in package.json`));
        console.log(dim(`  Available: ${Object.keys(scripts).join(', ')}`));
        process.exit(1);
      }
    }

    if (parallelFlag || scriptArgs.length > 1 && parallelFlag) {
      await runParallel(pm, scriptArgs, cwd);
    } else if (scriptArgs.length > 1) {
      await runSequential(pm, scriptArgs, cwd);
    } else {
      const result = await runScript(pm, scriptArgs[0], cwd);
      process.exit(result.exitCode);
    }
    return;
  }

  // ── Interactive TUI ──
  if (!process.stdin.isTTY) {
    // Non-interactive fallback
    printList(scripts, meta, pm, pkgName);
    console.log(dim('  (Run in a terminal for interactive mode)\n'));
    return;
  }

  // Loop: after running a script, return to TUI
  let lastScript = null;

  while (true) {
    const tui = new TUI(scripts, meta, pm, pkgName, cwd);
    tui.lastScript = lastScript;

    const result = await tui.run();

    if (result.action === 'quit') {
      console.log(dim('\nBye 👋\n'));
      break;
    }

    if (result.action === 'run') {
      lastScript = result.scripts[result.scripts.length - 1];

      // Re-load meta before each run to get fresh data
      const freshMeta = loadMeta(cwd);

      console.log('');

      if (result.parallel && result.scripts.length > 1) {
        await runParallel(pm, result.scripts, cwd);
      } else {
        for (const name of result.scripts) {
          console.log(`\n${clr(CYAN, bold(`▶ Running: ${name}`))}`);
          console.log(clr(DIM, '─'.repeat(Math.min(40, termWidth()))));
          const r = await runScript(pm, name, cwd);
          if (r.exitCode !== 0) {
            console.log(`\n${clr(RED, `✗ "${name}" failed`)} ${dim(`(exit ${r.exitCode}, ${fmtDuration(r.duration)})`)}`);
          } else {
            console.log(`\n${clr(GREEN, `✓ "${name}" done`)} ${dim(`(${fmtDuration(r.duration)})`)}`);
          }
        }
      }

      console.log(`\n${dim('Press any key to return to menu...')}`);

      // Wait for keypress to return
      await new Promise((resolve) => {
        const handler = () => {
          process.stdin.removeListener('data', handler);
          process.stdin.pause();
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          resolve();
        };
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', handler);
      });
    }
  }
}

main().catch((err) => {
  showCursor();
  console.error(clr(RED, `\n✗ Fatal error: ${err.message}`));
  process.exit(1);
});
