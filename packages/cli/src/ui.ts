import cfonts from 'cfonts';

const useColor =
  !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));

const esc = (code: string) => (useColor ? `\x1b[${code}m` : '');
const reset = esc('0');
const rgb = (r: number, g: number, b: number) => esc(`38;2;${r};${g};${b}`);
const bgRgb = (r: number, g: number, b: number) => esc(`48;2;${r};${g};${b}`);

export const c = {
  mint: (s: string) => `${rgb(195, 240, 184)}${s}${reset}`,
  green: (s: string) => `${rgb(123, 216, 143)}${s}${reset}`,
  forest: (s: string) => `${rgb(61, 135, 84)}${s}${reset}`,
  cream: (s: string) => `${rgb(220, 228, 214)}${s}${reset}`,
  dim: (s: string) => `${esc('2')}${s}${reset}`,
  bold: (s: string) => `${esc('1')}${s}${reset}`,
  italic: (s: string) => `${esc('3')}${s}${reset}`,
  red: (s: string) => `${rgb(233, 109, 92)}${s}${reset}`,
  slate: (s: string) => `${rgb(130, 140, 130)}${s}${reset}`,
  gold: (s: string) => `${rgb(245, 185, 76)}${s}${reset}`,
};

export const forest = c.forest;

const RUNTIME_COLORS: Record<string, [number, number, number]> = {
  'claude-code': [217, 119, 87],
  codex: [94, 155, 255],
  hermes: [245, 185, 76],
  openclaw: [123, 216, 143],
};

export function runtimeTag(runtime: string): string {
  const [r, g, b] = RUNTIME_COLORS[runtime] ?? [160, 160, 160];
  return `${bgRgb(30, 24, 18)}${rgb(r, g, b)} ${runtime.padEnd(11)} ${reset}`;
}

export function runtimeDot(runtime: string): string {
  const [r, g, b] = RUNTIME_COLORS[runtime] ?? [160, 160, 160];
  return `${rgb(r, g, b)}●${reset}`;
}

export function section(label: string): string {
  return `${c.green('◆')} ${c.bold(label.toUpperCase())}`;
}

export function rule(width = 78): string {
  return c.slate('─'.repeat(width));
}

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, Date.now() - t) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)}mo ago`;
  return `${Math.floor(d / 86400 / 365)}y ago`;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

export function shortenCwd(cwd?: string): string {
  if (!cwd) return c.dim('—');
  return cwd.replace(process.env.HOME ?? '', '~');
}

export function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1) + '…';
}

export function banner(subtitle?: string): string {
  if (!useColor) return `\n  memto${subtitle ? '  ' + subtitle : ''}\n`;
  const rendered = cfonts.render('memto', {
    font: 'block',
    gradient: ['#c3f0b8', '#7bd88f', '#2d6b3c'],
    transitionGradient: true,
    space: false,
    env: 'node',
    maxLength: 0,
  });
  const art = rendered ? rendered.string : 'memto';
  const tagline = c.slate('  memory for your fleet of AI coding agents');
  const sub = subtitle ? `   ${c.dim(subtitle)}` : '';
  return `${art}\n${tagline}${sub}\n`;
}
