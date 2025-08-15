// addon/lib/beautify.js
export async function beautifyTitles(streams, { id, type, beautify }) {
  const on = ['1','true','yes','on'].includes(String(beautify||'').toLowerCase());
  if (!on) return streams;

  try {
    const tid = id.replace(/^tt/i, 'tt');
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(tid)}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return streams;
    const data = await res.json();
    const name = data?.meta?.name || data?.meta?.originalName;
    if (!name) return streams;

    return streams.map(s => {
      const rest = (s.title || '').split('\n').slice(1).join('\n');
      return { ...s, title: `${name} — ${rest || (s.name || '')}` };
    });
  } catch {
    return streams;
  }
}
