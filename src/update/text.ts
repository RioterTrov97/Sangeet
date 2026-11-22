import type { UpdateState } from './store';

/** Release notes are GitHub Markdown; the TV shows plain lines (no headings, emphasis, links or HTML comments). */
export function plainNotes(md: string, maxLines = 8): string {
  const lines = md
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .trim(),
    )
    .filter(Boolean);
  return lines.slice(0, maxLines).join('\n');
}

const pct = (p: number): string => `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;

/** One line for Settings > Updates. */
export function statusLine(s: Pick<UpdateState, 'status' | 'progress' | 'release' | 'error' | 'lastChecked'>): string {
  const v = s.release?.version;
  switch (s.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Version ${v} is available`;
    case 'downloading':
      return `Downloading version ${v}, ${pct(s.progress)}`;
    case 'ready':
      return `Version ${v} is ready to install`;
    case 'installing':
      return `Installing version ${v}…`;
    case 'error':
      return s.error ? `Update failed: ${s.error}` : 'Update failed';
    default:
      return s.lastChecked ? 'Sangeet is up to date' : 'Not checked yet';
  }
}

/** The Home pill's text, or null when there is nothing to show. */
export function pillText(s: Pick<UpdateState, 'status' | 'progress' | 'release'>): string | null {
  const v = s.release?.version;
  if (!v) return null;
  switch (s.status) {
    case 'ready':
      return `Update ${v} ready`;
    case 'available':
      return `Update ${v} available`;
    case 'downloading':
      return `Downloading update ${pct(s.progress)}`;
    case 'installing':
      return 'Installing update…';
    default:
      return null;
  }
}
