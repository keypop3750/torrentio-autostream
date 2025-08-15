import { extractSeeders } from './titleHelper.js';
import { Type } from './types.js';
// Do not import the full moch implementation here because it pulls in optional
// dependencies which may not be installed in every environment.  Instead
// determine whether debrid is configured by inspecting the extra
// configuration object.  If any known debrid provider key is present the
// weighting will favour quality over speed.

/*
 * Apply AutoStream filtering and naming to a list of streams.
 *
 * This helper examines all available streams for a given item and returns a
 * curated list containing only the highest ranked version of the title.  If
 * the top version is greater than 1080p, a second entry representing the
 * best available 1080p version is appended.  Ranking is performed by
 * combining video resolution with seeder count.  When no debrid services
 * are configured the weighting favours seeders (speed) more heavily than
 * resolution; when debrid is configured the weighting favours resolution
 * slightly more.
 *
 * The returned streams have their `name` field rewritten to a friendly
 * format using the Cinemeta title where available.  For series this
 * includes a season/episode code (e.g. S02E05) and a trailing quality
 * indicator.  For movies the quality indicator is appended directly.  All
 * qualities above 1080p are mapped to 2K, 4K and 8K for clarity.
 *
 * @param {Array} streams The list of streams returned by Torrentio.
 * @param {Object} args Arguments provided to the stream handler, used to
 *   determine type and id (imdb/kitsu and season/episode).
 * @returns {Promise<Array>} A promise resolving to the curated stream list.
 */
export async function applyAutostream(streams, args) {
  if (!streams || !streams.length) {
    return streams;
  }

  // Attempt to resolve the canonical name via Cinemeta.  Fallback to the
  // torrent's title when Cinemeta fails or is unavailable.
  let baseName = null;
  const id = args.id || '';
  const type = args.type || '';
  try {
    if (id.startsWith('tt')) {
      const imdbId = id.split(':')[0];
      const endpointType = type === Type.SERIES ? 'series' : 'movie';
      const url = `https://v3-cinemeta.strem.io/meta/${endpointType}/${imdbId}.json`;
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        baseName = data?.meta?.name;
      }
    } else if (id.toLowerCase().startsWith('kitsu:')) {
      // Cinemeta exposes anime titles under the `anime` endpoint.  If
      // resolution fails the fallback below will be used.
      const kitsuId = id.split(':')[1];
      const endpointType = type === Type.MOVIE ? 'movie' : 'series';
      const url = `https://v3-cinemeta.strem.io/meta/${endpointType}/kitsu:${kitsuId}.json`;
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        baseName = data?.meta?.name;
      }
    }
  } catch (err) {
    // Ignore errors – baseName fallback will be used.
  }
  if (!baseName) {
    // Default to the first line of the title string, which contains the
    // torrent's name without the details.  This avoids including seeders,
    // size and provider in the display name.  If the first line is empty
    // fallback to the addon name.
    const firstLine = streams[0].title?.split('\n')[0];
    baseName = (firstLine && firstLine.trim()) || 'AutoStream';
  }

  // Determine whether the user has configured any debrid providers.
  // Determine whether any debrid providers are configured by checking
  // known keys on args.extra.  Extra may contain provider keys such as
  // "realdebrid", "alldebrid", "premiumize", "debridlink", "easydebrid",
  // "offcloud", "torbox" or "putio".  When any of these keys are present
  // weight quality slightly more than seeders.
  const debridKeys = ['realdebrid', 'premiumize', 'alldebrid', 'debridlink', 'easydebrid', 'offcloud', 'torbox', 'putio'];
  const extra = args.extra || {};
  const hasDebrid = Object.keys(extra).some((key) => debridKeys.includes(key) && !!extra[key]);

  // Helper to extract the quality descriptor from a stream.  The original
  // implementation writes the resolution/HDR line as the last line of the
  // `name` property (e.g. "Torrentio\n1080p HDR").  If a name is only
  // one line fall back to parsing the resolution out of the title.
  function getQualityDesc(stream) {
    if (stream.name) {
      const parts = stream.name.split('\n');
      const last = parts[parts.length - 1].trim();
      if (last && last.toLowerCase() !== 'torrentio') {
        return last;
      }
    }
    const match = stream.title && stream.title.match(/\b(\d{3,4}p)\b/i);
    return match ? match[1] : '';
  }

  // Convert a quality descriptor into a numeric resolution for comparison.
  function toResolutionNumber(desc) {
    if (!desc) return 0;
    const q = desc.toLowerCase();
    if (q.includes('8k') || q.includes('4320')) return 4320;
    if (q.includes('4k') || q.includes('2160') || q.includes('uhd')) return 2160;
    if (q.includes('2k') || q.includes('1440')) return 1440;
    const m = q.match(/(\d{3,4})p/);
    if (m) return parseInt(m[1]);
    return 0;
  }

  // Compute scores for each stream.  Higher scores are better.  Seeders
  // represent "speed" and resolution represents video quality.  Without
  // debrid, seeders are weighted more heavily; with debrid, quality is
  // weighted more heavily.  The chosen weights are heuristic – they can be
  // adjusted to fine tune the balance between speed and quality.
  const scored = streams.map((stream) => {
    const qualityDesc = getQualityDesc(stream);
    const resNum = toResolutionNumber(qualityDesc);
    const seeds = extractSeeders(stream.title) || 0;
    let score;
    if (hasDebrid) {
      // Weight quality more heavily when debrid is configured.  Multiply
      // seeders by a moderate factor to ensure they still contribute.
      score = resNum * 10 + seeds;
    } else {
      // When no debrid is configured speed matters more; multiply seeders
      // by a higher factor and add resolution to break ties.
      score = seeds * 20 + resNum;
    }
    return { stream, score, qualityDesc, resNum, seeds };
  });

  // Sort descending by score.
  scored.sort((a, b) => b.score - a.score);

  // Select the best stream.
  const top = scored[0];
  const resultStreams = [top];

  // If the best stream is above 1080p, include the best <=1080p stream as a
  // fallback option.  Exclude CAM/unknown qualities (resNum 0) from the
  // fallback search.
  if (top.resNum > 1080) {
    const fallback = scored.find((item) => item.resNum > 0 && item.resNum <= 1080);
    if (fallback && fallback !== top) {
      resultStreams.push(fallback);
    }
  }

  // Map resolution numbers into friendly labels.  Anything above 1080p is
  // converted to K notation.
  function toFriendlyQuality(resNum) {
    if (resNum >= 4320) return '8K';
    if (resNum >= 2160) return '4K';
    if (resNum >= 1440) return '2K';
    if (resNum === 1080) return '1080p';
    if (resNum === 720) return '720p';
    if (resNum === 480) return '480p';
    return resNum ? `${resNum}p` : '';
  }

  // Parse season and episode numbers from the id.  Both imdb and kitsu ids
  // follow the pattern `<base>:<season>:<episode>`.  Returns an object
  // containing zero-padded strings or null when not applicable.
  function parseEpisode(idString) {
    const parts = idString.split(':');
    if (parts.length >= 3) {
      const season = parts[1];
      const episode = parts[2];
      return {
        season: season.padStart(2, '0'),
        episode: episode.padStart(2, '0'),
      };
    }
    return null;
  }

  const episodeInfo = (type === Type.SERIES || type === Type.ANIME) ? parseEpisode(id) : null;

  // Build the new name for each selected stream.
  const curatedStreams = resultStreams.map(({ stream, resNum }) => {
    const friendlyQuality = toFriendlyQuality(resNum);
    let displayName = baseName;
    if (episodeInfo) {
      displayName += ` — S${episodeInfo.season}E${episodeInfo.episode} - ${friendlyQuality}`;
    } else {
      displayName += ` — ${friendlyQuality}`;
    }
    return {
      ...stream,
      name: displayName,
    };
  });

  return curatedStreams;
}