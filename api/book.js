// api/book.js
// salon楓 Googleカレンダー予約書き込み / 携帯・日時対応版
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
      preferredDate    = '',
      date2            = '',
      recommended_menu = '',
      score            = '',
      level            = '',
    } = req.body;

    if (!preferredDate) {
      return res.status(400).json({ error: 'preferredDate is required' });
    }

    // 日付パース（例: "2026年5月17日（日）14:00〜"）
    const dateMatch = preferredDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let startDate, endDate;
    if (dateMatch) {
      const y = dateMatch[1];
      const m = dateMatch[2].padStart(2,'0');
      const d = dateMatch[3].padStart(2,'0');
      startDate = `${y}-${m}-${d}`;
      const next = new Date(`${y}-${m}-${d}`);
      next.setDate(next.getDate() + 1);
      endDate = next.toISOString().split('T')[0];
    } else {
      const today = new Date().toISOString().split('T')[0];
      startDate = today;
      const next = new Date(today); next.setDate(next.getDate()+1);
      endDate = next.toISOString().split('T')[0];
    }

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
        `希望日時（第1）: ${preferredDate}`,
        date2 ? `希望日時（第2）: ${date2}` : '',
        `おすすめメニュー: ${recommended_menu}`,
        `スコア: ${score} / レベル: ${level}`,
        '',
        '※ AI診断フォームから自動登録。時刻はLINE/メールで確定してください。',
      ].filter(Boolean).join('\n'),
      start: { date: startDate },
      end:   { date: endDate },
      colorId: '6',
      attendees: email ? [{ email }] : [],
    };

    const inserted = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      sendUpdates: 'all',
    });

    return res.status(200).json({ ok: true, eventId: inserted.data.id });

  } catch (err) {
    console.error('[book]', err);
    return res.status(500).json({ error: err.message });
  }
};
