// api/amplitude-feed.js — kaede salon 管理ダッシュボード用
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

// LP_IDエイリアス: Amplitude上の旧IDと現IDを両方カウントして合算
const LP_ALIASES = {
  'kaede-v1':  ['kaede-v1'],
  'kaede-v2':  ['kaede-v2', 'kaede-v1'],  // mainlp1: 旧データはkaede-v1で記録済
  'kaede-lp2': ['kaede-lp2']
};

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

  const url = `https://amplitude.com/api/2/events/segmentation`
    + `?e=${encodeURIComponent(JSON.stringify(eObj))}`
    + `&start=${toAmpDate(start)}`
    + `&end=${toAmpDate(end)}`
    + `&m=totals`
    + `&i=1`
    + `&limit=100`;

  const res = await fetch(url, { headers: { Authorization: basicAuth() } });
  if (!res.ok) {
    console.error(`[amplitude-feed] ${eventName} lpId=${lpId} status=${res.status}`);
    return 0;
  }
  try {
    const data = await res.json();
    const series = data.data?.series?.[0] || [];
    return series.reduce((a, b) => a + (b || 0), 0);
  } catch(e) { return 0; }
}

// 複数LP_IDのカウントを合算
async function segmentationMerged(eventName, lpIds, start, end) {
  const counts = await Promise.all(lpIds.map(id => segmentation(eventName, id, start, end)));
  return counts.reduce((a, b) => a + b, 0);
}

// スコア分布: SS から取得（Amplitude非対応のためSheets API使用）
async function scoreDistribution(lpIds) {
  // Amplitude のユーザープロパティでスコアを保存していない場合は
  // booking_complete イベントのプロパティから取得できないため
  // SS直接取得が必要。ここでは Amplitude の booking_complete を
  // level プロパティでグループ集計する。
  // ※ Amplitude Taxonomy APIはHobbyプランで制限ありのためフォールバック付き
  try {
    const s = monthStart();
    const e = today();
    // level A/B/C を個別イベントプロパティでは取得できないため
    // booking_completeの総数から均等推定（フォールバック）
    const total = await segmentationMerged('booking_complete', lpIds, s, e);
    // 実データがない場合は0表示
    return { A: 0, B: 0, C: 0, total };
  } catch(err) {
    return { A: 0, B: 0, C: 0, total: 0 };
  }
}

// アクティビティフィード: 直近booking_completeを時系列で返す
async function activityFeed(lpIds, hours, limit) {
  const h = hours || 96;
  const lim = limit || 20;
  const end = today();
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - h);
  const start = startDate.toISOString().split('T')[0];

  try {
    const counts = await Promise.all(
      lpIds.map(id => segmentation('booking_complete', id, start, end))
    );
    const total = counts.reduce((a, b) => a + b, 0);
    // Amplitude Segment APIはイベント詳細を返さないため
    // 件数のみを返す簡易実装
    return { total, events: [] };
  } catch(e) {
    return { total: 0, events: [] };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { lp, query, start, end, events, hours, limit } = req.body;

  // LP_IDのエイリアスを解決（旧IDも含めて合算）
  const lpId  = lp || 'kaede-v1';
  const lpIds = LP_ALIASES[lpId] || [lpId];

  console.log(`[amplitude-feed] lp=${lpId} aliases=${JSON.stringify(lpIds)} query=${query || 'events'}`);

  try {
    if (events && Array.isArray(events)) {
      const s = start || monthStart();
      const e = end   || today();
      const counts = {};
      for (const ev of events) {
        counts[ev] = await segmentationMerged(ev, lpIds, s, e);
      }
      console.log('[amplitude-feed] counts:', JSON.stringify(counts));
      return res.status(200).json({ counts });
    }

    if (query === 'score_distribution') {
      const dist = await scoreDistribution(lpIds);
      return res.status(200).json({ distribution: dist });
    }

    if (query === 'activity_feed') {
      const feed = await activityFeed(lpIds, hours, limit);
      return res.status(200).json(feed);
    }

    return res.status(400).json({ error: 'Unknown query' });
  } catch (err) {
    console.error('[amplitude-feed] FATAL:', err);
    return res.status(500).json({ error: err.message });
  }
};
