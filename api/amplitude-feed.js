// api/amplitude-feed.js
// Amplitude Dashboard API 中継 / Path-Flow §5-2準拠
// ============================================================

const AMP_API_KEY    = process.env.AMPLITUDE_API_KEY;
const AMP_SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;
const BASE_URL       = 'https://amplitude.com/api/2';

// Basic認証ヘッダー生成
function basicAuth() {
  const token = Buffer.from(`${AMP_API_KEY}:${AMP_SECRET_KEY}`).toString('base64');
  return `Basic ${token}`;
}

// 日付フォーマット（Amplitude: YYYYMMDD）
function toAmpDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { lp, query, start, end, events, hours, limit } = req.body;

  try {

    // ── ① イベントカウント取得 ─────────────────────────────────
    if (events && Array.isArray(events) && start && end) {
      const counts = {};

      for (const eventName of events) {
        const params = new URLSearchParams({
          e:          JSON.stringify({ event_type: eventName, filters: [{ subprop_type: 'event', subprop_key: 'lp', subprop_op: 'is', subprop_value: [lp] }] }),
          start:      toAmpDate(start),
          end:        toAmpDate(end),
          m:          'uniques',
          i:          '-300000', // 全期間合計
          limit:      '1',
        });

        const ampRes = await fetch(`${BASE_URL}/events/segmentation?${params}`, {
          headers: { Authorization: basicAuth() },
        });

        if (ampRes.ok) {
          const data = await ampRes.json();
          // seriesはイベント数の配列 → 合計
          const series = data.data?.series?.[0] || [];
          counts[eventName] = series.reduce((a, b) => a + (b || 0), 0);
        } else {
          counts[eventName] = 0;
        }
      }

      return res.status(200).json({ counts });
    }

    // ── ② スコア分布取得 ───────────────────────────────────────
    if (query === 'score_distribution') {
      const params = new URLSearchParams({
        e:     JSON.stringify({ event_type: 'booking_complete', filters: [{ subprop_type: 'event', subprop_key: 'lp', subprop_op: 'is', subprop_value: [lp] }] }),
        g:     JSON.stringify([{ type: 'event', value: 'level' }]),
        start: toAmpDate((() => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().split('T')[0]; })()),
        end:   toAmpDate(new Date().toISOString().split('T')[0]),
        m:     'uniques',
        i:     '-300000',
        limit: '3',
      });

      const ampRes = await fetch(`${BASE_URL}/events/segmentation?${params}`, {
        headers: { Authorization: basicAuth() },
      });

      if (!ampRes.ok) return res.status(200).json({ distribution: { A: 0, B: 0, C: 0 } });

      const data = await ampRes.json();
      const distribution = { A: 0, B: 0, C: 0 };
      const labels = data.data?.seriesLabels || [];
      const series = data.data?.series || [];

      labels.forEach((label, i) => {
        const total = (series[i] || []).reduce((a, b) => a + (b || 0), 0);
        if (label === 'A') distribution.A = total;
        else if (label === 'B') distribution.B = total;
        else if (label === 'C') distribution.C = total;
      });

      return res.status(200).json({ distribution });
    }

    // ── ③ Activity Feed取得 ────────────────────────────────────
    if (query === 'activity_feed') {
      const hoursBack = hours || 4;
      const limitNum  = limit || 20;
      const now       = new Date();
      const since     = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

      const params = new URLSearchParams({
        event_type:  'any',
        start_time:  since.toISOString(),
        end_time:    now.toISOString(),
        limit:       String(limitNum),
      });

      const ampRes = await fetch(`${BASE_URL}/usersearch?${params}`, {
        headers: { Authorization: basicAuth() },
      });

      if (!ampRes.ok) return res.status(200).json({ events: [] });

      const data = await ampRes.json();
      const feedEvents = [];

      (data.matches || []).forEach(user => {
        (user.events || []).slice(0, 3).forEach(ev => {
          if (['page_view','diagnosis_click','booking_complete'].includes(ev.event_type)) {
            const evLp = ev.event_properties?.lp || '';
            if (!lp || evLp === lp) {
              feedEvents.push({
                event: ev.event_type,
                lp:    evLp,
                time:  new Date(ev.event_time).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
              });
            }
          }
        });
      });

      // 時刻降順ソート・limit件数に絞る
      feedEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
      return res.status(200).json({ events: feedEvents.slice(0, limitNum) });
    }

    return res.status(400).json({ error: 'Unknown query' });

  } catch (err) {
    console.error('[amplitude-feed]', err);
    return res.status(500).json({ error: err.message });
  }
};
