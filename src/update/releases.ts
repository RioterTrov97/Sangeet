import { compareVersions, parseVersion } from './version';

export type UpdateRelease = { version: string; notes: string; apkUrl: string; size: number; sha256?: string; /** Asset file name, used for the downloaded file. */ fileName: string };

/** The universal Android APK (phone and TV) is `sangeet-android-v*`; older releases only have `sangeet-tv-v*`. */
const APK = /^sangeet-(android|tv)-v[\d.]+\.apk$/;

type Asset = { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown };
type Raw = { tag_name?: unknown; draft?: unknown; body?: unknown; assets?: unknown };

/**
 * The newest release newer than `current` that has a versioned Android APK asset. Drafts are ignored; pre-releases count too
 * (a release someone marks pre-release by hand still updates installed apps). Order of the list does not matter.
 */
export function pickRelease(json: unknown, current: string): UpdateRelease | null {
  if (!Array.isArray(json)) return null;
  let best: UpdateRelease | null = null;
  for (const r of json as Raw[]) {
    if (!r || typeof r !== 'object' || r.draft === true) continue;
    const v = parseVersion(r.tag_name);
    if (!v || typeof r.tag_name !== 'string') continue;
    const version = v.join('.');
    if ((compareVersions(version, current) ?? 0) <= 0) continue;
    if (best && (compareVersions(version, best.version) ?? 0) <= 0) continue;
    const apks = (Array.isArray(r.assets) ? (r.assets as Asset[]) : []).filter((a) => a && typeof a.name === 'string' && APK.test(a.name) && typeof a.browser_download_url === 'string');
    const asset = apks.find((a) => (a.name as string).startsWith('sangeet-android-')) ?? apks[0];
    if (!asset) continue;
    const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest) : null;
    best = {
      version,
      notes: typeof r.body === 'string' ? r.body.trim() : '',
      apkUrl: asset.browser_download_url as string,
      fileName: asset.name as string,
      size: typeof asset.size === 'number' ? asset.size : 0,
      ...(digest ? { sha256: digest[1].toLowerCase() } : {}),
    };
  }
  return best;
}

export const releasesUrl = (repo: string): string => `https://api.github.com/repos/${repo}/releases?per_page=10`;

const TIMEOUT_MS = 10_000;

/** Fetches the releases list (no auth, short timeout) and picks the update, if any. Throws on network or HTTP errors. */
export async function fetchUpdate(url: string, current: string): Promise<UpdateRelease | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`releases HTTP ${res.status}`);
    return pickRelease(await res.json(), current);
  } finally {
    clearTimeout(timer);
  }
}
