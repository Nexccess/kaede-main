// api/save-shigyou.js — Path-Flow v3.3 | kaede salon（全LP共通）
// 対象LP: kaede-v1 / kaede-v2 / kaede-lp2
// Email: EmailJS REST API（Resendから移行）
// 統合: SS書込み → Googleカレンダー登録 → EmailJS通知（全3ステップ独立実行）

const { google } = require('googleapis');

// ── クライアント固有設定 ──────────────────────────────
const SHEET_NAME     = 'AI診断結果';
const NOTIFY_EMAIL   = process.env.OWNER_EMAIL  || 'info.kaedesalon@gmail.com';
const CALENDAR_ID    = process.env.CALENDAR_ID  || 'info.kaedesalon@gmail.com';
const SPREADSHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;
// ─────────────────────────────────────────────────────

// EmailJS REST API helper
async function sendViaEmailJS(params) {
  const serviceId  = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;  // Server-side requires private key

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EMAILJS_SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY not set');
  }

  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey || undefined,
    template_params: params
  };

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
      // origin ヘッダーを送らない: サーバーサイドはaccessToken認証
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`EmailJS ${res.status}: ${text.slice(0, 120)}`);
  }
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lp, name, phone, email,
    date, date2,
    recommended_menu, score, level, answers
  } = req.body || {};

  if (!name || !phone || !email || !date) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  // ── Google Auth ──────────────────────────────────────
  let auth;
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar'
      ]
    });
  } catch (e) {
    console.error('[save-shigyou] Auth parse error:', e.message);
    return res.status(500).json({ error: 'Auth failed' });
  }

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const log = [];

  // ── 1. Spreadsheet ────────────────────────────────────
  try {
    if (!SPREADSHEET_ID) throw new Error('SHIGYOU_SPREADSHEET_ID not set');
    const sheets = google.sheets({ version: 'v4', auth });

    let hasHeader = false;
    try {
      const chk = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`
      });
      hasHeader = !!(chk.data.values && chk.data.values[0] && chk.data.values[0][0]);
    } catch(_) {}

    if (!hasHeader) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['送信日時','LP_ID','お名前','携帯電話','メールアドレス',
                    '希望日時（第1）','希望日時（第2）','推奨メニュー','スコア','レベル','診断回答']]
        }
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[now, lp||'', name, phone, email,
                  date, date2||'', recommended_menu||'',
                  score||'', level||'', answers||'']]
      }
    });
    log.push('ss:ok');
  } catch (e) {
    console.error('[save-shigyou] Sheets error:', e.message);
    log.push('ss:fail:' + e.message.slice(0, 80));
  }

  // ── 2. Google Calendar ────────────────────────────────
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const dateStr = (date || '').split(' ')[0];
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error('Invalid date format: ' + dateStr);
    }
    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `【仮予約】${name} 様`,
        description: [
          `LP: ${lp}`,
          `メニュー: ${recommended_menu}`,
          `スコア: ${score} / レベル: ${level}`,
          `電話: ${phone}`,
          `メール: ${email}`,
          `希望日時: ${date}`,
          `第2希望: ${date2 || 'なし'}`,
          `診断回答: ${answers}`
        ].join('\n'),
        start: { date: dateStr },
        end: { date: dateStr }
      }
    });
    log.push('cal:ok');
  } catch (e) {
    console.error('[save-shigyou] Calendar error:', e.message);
    log.push('cal:fail:' + e.message.slice(0, 80));
  }

  // ── 3. EmailJS ────────────────────────────────────────
  try {
    const message = [
      `受付: ${now}`,
      `LP: ${lp || '—'}`,
      `お名前: ${name}`,
      `電話: ${phone}`,
      `メール: ${email}`,
      `第1希望: ${date}`,
      `第2希望: ${date2 || 'なし'}`,
      `推奨メニュー: ${recommended_menu || '—'}`,
      `スコア/レベル: ${score || '—'} / ${level || '—'}`,
      `診断回答: ${answers || '—'}`
    ].join('\n');

    await sendViaEmailJS({
      to_email:         NOTIFY_EMAIL,
      reply_to:         email,
      lp_id:            lp || '—',
      customer_name:    name,
      customer_phone:   phone,
      customer_email:   email,
      booking_date:     date,
      booking_date2:    date2 || 'なし',
      recommended_menu: recommended_menu || '—',
      score:            String(score || '—'),
      level:            level || '—',
      answers:          answers || '—',
      sent_at:          now,
      message:          message
    });
    log.push('email:ok');
  } catch (e) {
    console.error('[save-shigyou] EmailJS error:', e.message);
    log.push('email:fail:' + e.message.slice(0, 80));
    // 非致命的: SSが成功していれば200を返す
  }

  const ssFailed = log.some(l => l.startsWith('ss:fail'));
  return res.status(ssFailed ? 500 : 200).json({ ok: !ssFailed, log });
};
