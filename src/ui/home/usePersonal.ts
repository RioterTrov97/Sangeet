import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { perfTime } from '../../util/perf';
import { affinityArtistIds, isPersonalised, mergeArtists, pickSeeds, topArtists, type TopArtist } from '../../home/personalize';
import { followedArtists, useLibraryStore } from '../../library/store';
import { getHistory, getPlays, onHistoryChange } from '../../player/history';
import type { Artist, Track } from '../../youtube/models';

export type Personal = { personalised: boolean; recent: Track[]; artists: TopArtist[]; artistItems: Artist[]; followed: Artist[]; seeds: Track[]; liked: Set<string>; plays: number };

const EMPTY: Personal = { personalised: false, recent: [], artists: [], artistItems: [], followed: [], seeds: [], liked: new Set(), plays: 0 };
/** Recompute after this many new plays (or when the app returns to the foreground). */
export const RECOMPUTE_AFTER_PLAYS = 3;

function compute(): Personal {
  return perfTime('personal compute', computeNow);
}

function computeNow(): Personal {
  const now = Date.now();
  const plays = getPlays(30, now);
  const artists = topArtists(plays, now, 10);
  const followed = followedArtists();
  return {
    personalised: isPersonalised(plays),
    recent: getHistory().slice(0, 20),
    artists,
    artistItems: mergeArtists(followed, artists),
    followed,
    seeds: pickSeeds(plays, now, 2),
    liked: affinityArtistIds(useLibraryStore.getState().liked, artists, followed),
    plays: plays.length,
  };
}

/** On-device personalisation snapshot; recomputed on app foreground and after a few new plays (so seeds stay stable between). */
export function usePersonal(): Personal {
  const [p, setP] = useState<Personal>(() => {
    try {
      return compute();
    } catch {
      return EMPTY;
    }
  });
  const last = useRef(p.plays);
  const followKey = useLibraryStore((s) => s.saved.filter((x) => x.kind === 'artist').map((x) => x.id).join(','));
  const seenKey = useRef(followKey);
  useEffect(() => {
    // Following / unfollowing refreshes the snapshot right away. (Not on mount: the initial state was just computed.)
    if (seenKey.current === followKey) return;
    seenKey.current = followKey;
    const t = setTimeout(() => {
      try {
        setP(compute());
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [followKey]);
  useEffect(() => {
    const refresh = () => {
      try {
        const n = compute();
        last.current = n.plays;
        setP(n);
      } catch {
        /* history unavailable: keep the default Home */
      }
    };
    const off = onHistoryChange(() => {
      try {
        if (getPlays(30).length - last.current >= RECOMPUTE_AFTER_PLAYS || (!p.personalised && getPlays(30).length >= 5)) refresh();
      } catch {
        /* ignore */
      }
    });
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      off();
      sub.remove();
    };
  }, [p.personalised]);
  return p;
}
