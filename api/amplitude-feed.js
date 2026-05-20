// amplitude-feed.js デバッグ版 - レスポンス全体をログ出力
const AMP_API_KEY    = process.env.AMPLITUDE_API_KEY;
const AMP_SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

function basicAuth() {
  return 'Basic ' + Buffer.from(`${AMP_API_KEY}:${AMP_SECRET_KEY}`).toString('base64');
}
function toAmpDate(d) { return d.replace(/-/g, ''); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function today() { return new Date().toISOString().split('T')[0]; }

async function segmentation(eventName, lpId, start, end) {
  const eObj = {
    event_type: eventName,
    filters: [{
      subprop_type: 'event',
      subprop_key: 'lp',
      subprop_op: 'is',
      subprop_value: [lpId]
    }]
  };

  // URLを手動構築（JSON二重エンコード回避）
  const url = `https://amplitude.com/api/2/events/segmentation`
    + `?e=${encodeURIComponent(JSON.stringify(eObj))}`
    + `&start=${toAmpDate(start)}`
    + `&end=${toAmpDate(end)}`
    + `&m=totals`
    + `&i=1`
    + `&limit=100`;

  console.log(`[amplitude-feed] URL: ${url.substring(0,200)}`);

  const res = await fetch(url, { headers: { Authorization: basicAuth() } });
  const txt = await res.text();
  console.log(`[amplitude-feed] ${eventName} status=${res.status} body=${txt.substring(0,300)}`);

  if (!res.ok) return 0;
  try {
    const data = JSON.parse(txt);
    const series = data.data?.series?.[0] || [];
    const total = series.reduce((a, b) => a + (b || 0), 0);
    console.log(`[amplitude-feed] ${eventName} total=${total} series=${JSON.stringify(series.slice(0,5))}`);
    return total;
  } catch(e) { return 0; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { lp, query, start, end, events, hours, limit } = req.body;
  const lpId = lp || 'kaede-v1';

  try {
    if (events && Array.isArray(events)) {
      const s = start || monthStart();
      const e = end   || today();
      const counts = {};
      for (const ev of events) {
        counts[ev] = await segmentation(ev, lpId, s, e);
      }
      console.log('[amplitude-feed] counts:', JSON.stringify(counts));
      return res.status(200).json({ counts });
    }
    if (query === 'score_distribution') {
      return res.status(200).json({ distribution: { A:0, B:0, C:0 } });
    }
    if (query === 'activity_feed') {
      return res.status(200).json({ events: [] });
    }
    return res.status(400).json({ error: 'Unknown query' });
  } catch (err) {
    console.error('[amplitude-feed] FATAL:', err);
    return res.status(500).json({ error: err.message });
  }
};
