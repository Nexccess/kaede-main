// api/book.js
// salon楓 Googleカレンダー予約 / yyyy-mm-dd形式対応版
// ============================================================
const { google } = require('googleapis');

const CALENDAR_ID = process.env.CALENDAR_ID;
const SA_JSON     = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      name             = '',
      phone            = '',
      email            = '',
      preferredDate    = '', // yyyy-mm-dd（ISO形式）
      preferredTime    = '', // HH:MM〜HH:MM
      date2            = '',
      recommended_menu = '',
      score            = '',
      level            = '',
    } = req.body;

    if (!preferredDate) {
      return res.status(400).json({ error: 'preferredDate is required' });
    }

    // ISO形式（yyyy-mm-dd）を直接使用
    const startDate = preferredDate; // 例: 2026-05-19
    const nextDay   = new Date(preferredDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDate = nextDay.toISOString().split('T')[0];

    const credentials = JSON.parse(SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: `【仮予約】${name} 様 / ${recommended_menu}`,
      description: [
        `お名前: ${name}`,
        `携帯電話: ${phone}`,
        `メール: ${email}`,
        `希望日時（第1）: ${preferredDate.replace(/-/g,'/')} ${preferredTime}`,
        date2 ? `希望日時（第2）: ${date2}` : '',
        `おすすめメニュー: ${recommended_menu}`,
        `スコア: ${score} / レベル: ${level}`,
        '',
        '※ AI診断フォームから自動登録。詳細はLINE/メールで確定してください。',
      ].filter(Boolean).join('\n'),
      start: { date: startDate },
      end:   { date: endDate },
      colorId: '6',
    };

    const inserted = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
    });

    return res.status(200).json({ ok: true, eventId: inserted.data.id });

  } catch (err) {
    console.error('[book]', err);
    return res.status(500).json({ error: err.message });
  }
};
