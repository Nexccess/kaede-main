// api/book.js
// salon楓 Googleカレンダー予約書き込み
// ============================================================

const { google } = require('googleapis');

const CALENDAR_ID = process.env.CALENDAR_ID;   // info.kaedesalon@gmail.com
const SA_JSON     = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      name            = '',
      email           = '',
      preferredDate   = '',
      recommended_menu= '',
      score           = '',
      level           = '',
    } = req.body;

    if (!preferredDate) {
      return res.status(400).json({ error: 'preferredDate is required' });
    }

    // ── 日時パース（例: "2026年5月17日（日）14:00〜"）──────────────
    // カレンダーには「終日イベント」として登録（確定時刻は担当者が調整）
    // 日付文字列から年月日を抽出
    const dateMatch = preferredDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    let startDate, endDate;
    if (dateMatch) {
      const y = dateMatch[1].padStart(4,'0');
      const m = dateMatch[2].padStart(2,'0');
      const d = dateMatch[3].padStart(2,'0');
      startDate = `${y}-${m}-${d}`;
      // 終日イベントのendは翌日
      const nextDay = new Date(`${y}-${m}-${d}`);
      nextDay.setDate(nextDay.getDate() + 1);
      endDate = nextDay.toISOString().split('T')[0];
    } else {
      // 日付解析失敗時は当日
      const today = new Date().toISOString().split('T')[0];
      startDate = today;
      const nextDay = new Date(today);
      nextDay.setDate(nextDay.getDate() + 1);
      endDate = nextDay.toISOString().split('T')[0];
    }

    // ── Google Calendar 認証 ──────────────────────────────────────
    const credentials = JSON.parse(SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth });

    // ── イベント作成 ──────────────────────────────────────────────
    const event = {
      summary:     `【仮予約】${name} 様 / ${recommended_menu}`,
      description: [
        `お名前: ${name}`,
        `メール: ${email}`,
        `希望日: ${preferredDate}`,
        `おすすめメニュー: ${recommended_menu}`,
        `スコア: ${score} / レベル: ${level}`,
        '',
        '※ このイベントはAI診断フォームから自動登録されました。',
        '※ 時刻・詳細はLINEまたはメールで確定してください。',
      ].join('\n'),
      start: { date: startDate },
      end:   { date: endDate },
      colorId: '6',   // タンジェリン（仮予約を視覚的に識別）
      attendees: email ? [{ email }] : [],
    };

    const inserted = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      sendUpdates: 'all',   // 招待メールをお客様にも送信
    });

    return res.status(200).json({ ok: true, eventId: inserted.data.id });

  } catch (err) {
    console.error('[book]', err);
    return res.status(500).json({ error: err.message });
  }
};
