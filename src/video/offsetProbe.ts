// Dev-only research harness (reached from the `offsetscan` dev command): finds songs' videos and runs every offset method with timings.
import { log } from '../util/log';
import { fetchEnvelope } from './audioEnvelope';

/** Finds each query's top song and its video, then runs every offset method on the pair and logs one result row. */
export async function scan(queries: string[], all = true): Promise<void> {
  const { search } = await import('../youtube/api');
  const { resolveVideoId } = await import('./counterpart');
  const { decideOffset, noteVideoDuration } = await import('./offsets');
  const { audioFileUrl, resolver } = await import('../player/proxy');
  const { getLyrics } = await import('../lyrics');
  for (const q of queries) {
    try {
      const res = await search(q, 'song');
      const song = res.items.find((i) => i.kind === 'track');
      if (!song || song.kind !== 'track') {
        log('offset', `scan "${q}": no song`);
        continue;
      }
      const videoId = await resolveVideoId(song);
      if (!videoId) {
        log('offset', `scan "${q}": ${song.id} has no video`);
        continue;
      }
      const out = await decideOffset(
        song,
        videoId,
        {
          videoDuration: async (id) => {
            const s = await resolver.resolve(id);
            noteVideoDuration(id, s.durationMs ? s.durationMs / 1000 : undefined);
            return s.durationMs ? s.durationMs / 1000 : undefined;
          },
          lyrics: (t) => getLyrics(t),
          envelope: (id, sec) => fetchEnvelope(audioFileUrl(id), sec, 'moof'),
        },
        { all },
      );
      log('offset', `SCAN ${JSON.stringify({ q, title: song.title, artist: song.artists[0]?.name, song: song.id, songLen: song.durationSec, video: videoId, steps: out.steps })}`);
    } catch (e) {
      log('offset', `scan "${q}" failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
