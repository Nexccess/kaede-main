// api/save-shigyou.js — Path-Flow v3.2 | kaede salon
// 統合: スプレッドシート書込み + Googleカレンダー登録 + Resendメール通知

const { google } = require('googleapis');
const { Resend } = require('resend');

// ★ クライアント固有設定
const SHEET_NAME    = 'AI診断結果';
const NOTIFY_EMAIL  = process.env.OWNER_EMAIL || 'info.kaedesalon@gmail.com';
const FROM_EMAIL    = 'noreply@main.pathflow.org';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lp, name, phone, email,
    date, date2,
    recommended_menu, score, level, answers
  } = req.body || {};

  if (!name || !phone || !email || !date) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  // ---- Google Auth ----
  let auth;
  try {
    const serviceAccountJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials: serviceAccountJson,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ]
    });
  } catch (e) {
    console.error('Auth error:', e.message);
    return res.status(500).json({ error: 'Auth failed' });
  }

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const errors = [];

  // ---- 1. Spreadsheet write ----
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SHIGYOU_SPREADSHEET_ID;

    // Check if header row exists
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:A1`
    });

    if (!existing.data.values || existing.data.values.length === 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['送信日時','LP_ID','お名前','携帯電話','メールアドレス','希望日時（第1）','希望日時（第2）','おすすめメニュー','スコア','レベル','診断回答']]
        }
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[now, lp || '', name, phone, email, date, date2 || '', recommended_menu || '', score || '', level || '', answers || '']]
      }
    });
  } catch (e) {
    console.error('Sheets error:', e.message);
    errors.push('sheets');
  }

  // ---- 2. Google Calendar insert ----
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.CALENDAR_ID;

    // Parse date string (yyyy-mm-dd)
    const dateStr = date.split(' ')[0]; // "2026-06-01 11:00〜" → "2026-06-01"
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: `【仮予約】${name} 様`,
          description: `LP: ${lp}\nメニュー: ${recommended_menu}\nスコア: ${score} / レベル: ${level}\n電話: ${phone}\nメール: ${email}\n希望時間: ${date}\n第2希望: ${date2 || 'なし'}\n診断回答: ${answers}`,
          start: { date: dateStr },
          end: { date: dateStr }
        }
      });
    }
  } catch (e) {
    console.error('Calendar error:', e.message);
    errors.push('calendar');
  }

  // ---- 3. Resend email notification ----
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: `【kaede salon 仮予約】${name} 様`,
      text: [
        '【kaede 楓 salon — 新規仮予約通知】',
        '',
        `受付日時: ${now}`,
        `LP ID: ${lp}`,
        `お名前: ${name}`,
        `携帯電話: ${phone}`,
        `メールアドレス: ${email}`,
        `第1希望: ${date}`,
        `第2希望: ${date2 || 'なし'}`,
        `推奨メニュー: ${recommended_menu}`,
        `スコア / レベル: ${score} / ${level}`,
        `診断回答: ${answers}`,
        '',
        '---',
        'このメールはPath-Flowシステムから自動送信されています。',
        '返信はご予約者のメールアドレスに届きます。'
      ].join('\n')
    });
  } catch (e) {
    console.error('Resend error:', e.message);
    errors.push('email');
    // non-fatal: continue
  }

  return res.status(200).json({ ok: true, errors: errors.length > 0 ? errors : undefined });
};
