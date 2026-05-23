// api/amplitude-feed.js — kaede salon 管理ダッシュボード用 v2
const AMP_API_KEY    = process.env.AMPLITUDE_API_KEY;
const AMP_SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

const ALL_LP_IDS = ['kaede-v1', 'kaede-v2', 'kaede-lp2'];

function basicAuth() {
  return 'Basic ' + Buffer.from(`${AMP_API_KEY}:${AMP_SECRET_KEY}`).toString('base64');
}
function toAmpDate(d) { return d.replace(/-/g, ''); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function today() { return new Date().toISOString().split('T')[0]; }
function weeksAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().split('T')[0];
}

async function segmentation(eventName, lpId, start, end) {
  const eObj = {
    event_type: eventName,
    filters: [{ subprop_type: 'event', subprop_key: 'lp', subprop_op: 'is', subprop_value: [lpId] }]
  };
  const url = `https://amplitude.com/api/2/events/segmentation`
    + `?e=${encodeURIComponent(JSON.stringify(eObj))}`
    + `&start=${toAmpDate(start)}&end=${toAmpDate(end)}&m=totals&i=1&limit=100`;

  try {
    const res = await fetch(url, { headers: { Authorization: basicAuth() } });
    if (!res.ok) { console.error(`[amp] ${eventName} ${lpId} ${res.status}`); return { total: 0, series: [] }; }
    const data = await res.json();
    const series = data.data?.series?.[0] || [];
    return { total: series.reduce((a, b) => a + (b || 0), 0), series };
  } catch(e) { return { total: 0, series: [] }; }
}

// 複数LP合算
async function segmentationMerged(eventName, lpIds, start, end) {
  const results = await Promise.all(lpIds.map(id => segmentation(eventName, id, start, end)));
  const total = results.reduce((a, r) => a + r.total, 0);
  // seriesは要素数が同じなら合算
  const maxLen = Math.max(...results.map(r => r.series.length), 0);
  const series = Array.from({ length: maxLen }, (_, i) =>
    results.reduce((a, r) => a + (r.series[i] || 0), 0)
  );
  return { total, series };
}

// 週別トレンド: 過去5週を月曜〜日曜で区切って集計
async function weeklyTrend(lpIds, events) {
  const weeks = [];
  for (let i = 4; i >= 0; i--) {
    const start = weeksAgo(i + 1);
    const end   = weeksAgo(i);
    const label = i === 0 ? '今週' : i === 1 ? '先週' : `${i+1}週前`;
    const counts = {};
    for (const ev of events) {
      const r = await segmentationMerged(ev, lpIds, start, end);
      counts[ev] = r.total;
    }
    weeks.push({ label, counts });
  }
  return weeks;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { lp, query, start, end, events, hours, limit } = req.body;

  // lp='ALL' or undefined → 全LP合算。それ以外は単一LP
  const lpIds = (!lp || lp === 'ALL') ? ALL_LP_IDS : [lp];

  console.log(`[amp-feed] lp=${lp||'ALL'} query=${query||'events'} lpIds=${JSON.stringify(lpIds)}`);

  try {
    // ── イベントカウント（月次）
    if (events && Array.isArray(events)) {
      const s = start || monthStart();
      const e = end   || today();
      const counts = {};
      for (const ev of events) {
        const r = await segmentationMerged(ev, lpIds, s, e);
        counts[ev] = r.total;
      }
      return res.status(200).json({ counts });
    }

    // ── 週別トレンド（過去5週）
    if (query === 'weekly_trend') {
      const trend = await weeklyTrend(lpIds, ['page_view', 'diagnosis_click', 'booking_complete']);
      return res.status(200).json({ trend });
    }

    // ── スコア分布（booking_completeのlevelプロパティで集計）
    if (query === 'score_distribution') {
      // Amplitude Segmentation APIでlevelプロパティごとにカウント
      const levels = ['A', 'B', 'C'];
      const dist = { A: 0, B: 0, C: 0 };
      const s = '20260101'; // 全期間
      const e = toAmpDate(today());

      for (const level of levels) {
        const eObj = {
          event_type: 'booking_complete',
          filters: [
            { subprop_type: 'event', subprop_key: 'lp',    subprop_op: 'is', subprop_value: lpIds },
            { subprop_type: 'event', subprop_key: 'level', subprop_op: 'is', subprop_value: [level] }
          ]
        };
        const url = `https://amplitude.com/api/2/events/segmentation`
          + `?e=${encodeURIComponent(JSON.stringify(eObj))}`
          + `&start=${s}&end=${e}&m=totals&i=1&limit=100`;
        try {
          const r = await fetch(url, { headers: { Authorization: basicAuth() } });
          if (r.ok) {
            const data = await r.json();
            const series = data.data?.series?.[0] || [];
            dist[level] = series.reduce((a, b) => a + (b || 0), 0);
          }
        } catch(_) {}
      }
      return res.status(200).json({ distribution: dist });
    }

    // ── アクティビティフィード（直近イベントをuser_activityで取得）
    if (query === 'activity_feed') {
      const h = hours || 4;
      const lim = limit || 20;
      const startTime = new Date(Date.now() - h * 60 * 60 * 1000);
      const s = startTime.toISOString().split('T')[0];
      const e = today();

      // Amplitude Events APIでbooking_completeイベントを取得
      const eObj = {
        event_type: 'booking_complete',
        filters: [{ subprop_type: 'event', subprop_key: 'lp', subprop_op: 'is', subprop_value: lpIds }]
      };
      const url = `https://amplitude.com/api/2/events/segmentation`
        + `?e=${encodeURIComponent(JSON.stringify(eObj))}`
        + `&start=${toAmpDate(s)}&end=${toAmpDate(e)}&m=totals&i=1&limit=${lim}`;

      try {
        const r = await fetch(url, { headers: { Authorization: basicAuth() } });
        if (r.ok) {
          const data = await r.json();
          const series = data.data?.series?.[0] || [];
          const total = series.reduce((a, b) => a + (b || 0), 0);
          return res.status(200).json({ total, events: [] });
        }
      } catch(_) {}
      return res.status(200).json({ total: 0, events: [] });
    }

    return res.status(400).json({ error: 'Unknown query' });
  } catch (err) {
    console.error('[amp-feed] FATAL:', err);
    return res.status(500).json({ error: err.message });
  }
};
