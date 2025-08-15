// addon/lib/autostream.js
import { extractSeeders } from './titleHelper.js';
import { hasMochConfigured } from '../moch/moch.js';

/** AutoStream-inspired scorer & selector for Torrentio streams */
const DEFAULTS = {
  preferLowerIfMuchFaster: true,
  ratioNeed: 1.35,          // how many times faster the lower quality must be (seeds proxy)
  deltaNeed: 200,           // additive advantage on the "speed" proxy
  rule: 'ratio_and_delta',  // 'ratio_and_delta' | 'ratio_or_delta'
  twoOutputs: true,         // return second 1080p if top isn't 1080p
  tightenWhenDebrid: true   // if debrid is configured, keep higher quality more often
};

export function applyAutoStream(streams, extra = {}, type) {
  if (!streams?.length) return [];

  const opts = parseOptions(extra);
  const deduped = dedupeStreams(streams);
  const scored = deduped.map(s => ({ s, score: rankStream(s) }))
                        .sort((a,b) => b.score - a.score)
                        .map(x => x.s);

  // If not allowed to downgrade for speed, just return top (+1080p)
  if (!opts.preferLowerIfMuchFaster) return top2(scored, opts.twoOutputs);

  const best = scored[0];
  const bestTag = qualityTag(best.name + ' ' + (best.title||''));
  const candidates = scored.slice(1);

  // find best lower-quality alternative
  const alt = candidates.find(st =>
    qualityOrder(qualityTag(st.name + ' ' + (st.title||''))) <
    qualityOrder(bestTag)
  );

  let picked = best;
  if (alt) {
    const ok = isMuchFaster(alt, best, opts);
    if (ok && !opts.tightenWhenDebrid) {
      picked = alt;
    } else if (ok && opts.tightenWhenDebrid) {
      const tightened = { ...opts, ratioNeed: opts.ratioNeed * 1.2, rule: 'ratio_and_delta' };
      if (isMuchFaster(alt, best, tightened)) picked = alt;
    }
  }

  const out = [picked];
  if (opts.twoOutputs) {
    const pTag = qualityTag(picked.name + ' ' + (picked.title||''));
    if (pTag !== '1080p') {
      const alt1080 = candidates.find(st =>
        qualityTag(st.name + ' ' + (st.title||'')) === '1080p' && !sameStream(st, picked)
      );
      if (alt1080) out.push(alt1080);
    }
  }
  return out;
}

function parseOptions(extra) {
  const withDebrid = hasMochConfigured(extra);
  return {
    preferLowerIfMuchFaster: bool(extra?.ratio || extra?.delta || extra?.preferlower, true),
    ratioNeed: num(extra?.ratio, DEFAULTS.ratioNeed),
    deltaNeed: num(extra?.delta, DEFAULTS.deltaNeed),
    rule: (extra?.rule === 'ratio_or_delta') ? 'ratio_or_delta' : DEFAULTS.rule,
    twoOutputs: bool(extra?.top2 ?? extra?.two ?? extra?.twooutputs, DEFAULTS.twoOutputs),
    tightenWhenDebrid: bool(extra?.tighten ?? withDebrid, DEFAULTS.tightenWhenDebrid),
  }
}

function num(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }
function bool(v, d) { if (v === undefined) return d; return ['1','true','yes','on'].includes(String(v).toLowerCase()); }

function sameStream(a, b) {
  return (a.infoHash && b.infoHash && a.infoHash === b.infoHash)
      || (a.url && b.url && a.url === b.url);
}
function dedupeStreams(list) {
  const seen = new Set(), out = [];
  for (const st of list) {
    const k = st.infoHash || st.url || (st.behaviorHints?.bingeGroup || '') + (st.behaviorHints?.filename || '');
    if (seen.has(k)) continue; seen.add(k); out.push(st);
  }
  return out;
}

// ----- scoring -----
function rankStream(st) {
  const label = (st.name || '') + ' ' + (st.title || '');
  const q = qualityBaseScore(qualityTag(label));
  const seeds = extractSeeders(st.title || '') || 0;
  const speed = Math.log1p(Math.max(0, seeds)) * 200;
  return q + speed + preferenceBonus(label);
}
function qualityTag(label) {
  const l = String(label).toLowerCase();
  if (/\b(4320p|8k)\b/.test(l)) return '4320p';
  if (/\b(2160p|4k|uhd)\b/.test(l)) return '2160p';
  if (/\b(1440p|2k)\b/.test(l)) return '1440p';
  if (/\b1080p\b/.test(l)) return '1080p';
  if (/\b720p\b/.test(l)) return '720p';
  if (/\b480p\b/.test(l)) return '480p';
  if (/\b(cam|telesync|telecine|scr)\b/.test(l)) return 'CAM';
  return 'other';
}
function qualityOrder(tag){ return ['other','CAM','480p','720p','1080p','1440p','2160p','4320p'].indexOf(tag) }
function qualityBaseScore(tag){
  switch(tag){
    case '4320p': return 1200; case '2160p': return 1000; case '1440p': return 800;
    case '1080p': return 600; case '720p': return 400; case '480p': return 200; default: return 100;
  }
}
function preferenceBonus(label){
  const l = String(label).toLowerCase();
  let bonus = 0;
  if (/(web[-\s]?dl|web[-\s]?rip)\b/.test(l)) bonus += 30;
  if (/\b(remux|blu[-\s]?ray|b[dr]rip)\b/.test(l)) bonus += 40;
  if (/\b(hevc|x265)\b/.test(l)) bonus += 10;
  if (/\b(real[-\s]?debrid|premiumize|all[-\s]?debrid|rd|ad|pm)\b/.test(l)) bonus += 20;
  return bonus;
}
function speedProxy(st){ const seeds = extractSeeders(st.title || '') || 0; return Math.log1p(Math.max(0, seeds)) * 200; }
function isMuchFaster(low, high, { ratioNeed, deltaNeed, rule }){
  const a = speedProxy(low), b = speedProxy(high);
  const ratio = b > 0 ? a / b : Infinity;
  const delta = a - b;
  return rule === 'ratio_or_delta' ? (ratio >= ratioNeed || delta >= deltaNeed)
                                   : (ratio >= ratioNeed && delta >= deltaNeed);
}
function top2(list, twoOutputs){
  if (!twoOutputs) return [list[0]];
  const top = list[0], topTag = qualityTag(top.name + ' ' + (top.title||''));
  if (topTag !== '1080p') {
    const alt1080 = list.find(s => qualityTag(s.name + ' ' + (s.title||'')) === '1080p' && !sameStream(s, top));
    if (alt1080) return [top, alt1080];
  }
  const second = list.find(s => !sameStream(s, top));
  return second ? [top, second] : [top];
}
