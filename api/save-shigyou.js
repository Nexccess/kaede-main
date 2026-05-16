// api/save-shigyou.js
// Path-Flow 標準 / salon楓 設定
// ============================================================
const { google } = require('googleapis');
const { Resend }  = require('resend');

// ── クライアント固有設定 ──────────────────────────────────────
const SHEET_NAME = 'AI診断結果';          // ← SSシート名と完全一致
const NOTIFY_TO  = ['info.kaedesalon@gmail.com'];  // ← 通知先

// ── 環境変数（Vercel設定） ────────────────────────────────────
const SPREADSHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;
// 1WZZKJrT06I7nYQPm5UMhW-0IJVfiqk-hNbiGs9SAD3s
const SA_JSON        = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const RESEND_KEY     = process.env.RESEND_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      lp              = '',
      name            = '',
      email           = '',
      recommended_menu= '',
      score           = '',
      level           = '',
      answers         = [],
    } = req.body;

    const now       = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const answersStr= Array.isArray(answers) ? answers.join(' / ') : String(answers);

    // ── Google Sheets への書き込み ─────────────────────────────
    const saCredentials = JSON.parse(SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: saCredentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range:         `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,            // A: 送信日時
          lp,             // B: LP識別ID
          name,           // C: お名前
          email,          // D: メールアドレス
          recommended_menu, // E: おすすめメニュー
          score,          // F: スコア
          level,          // G: レベル
          answersStr,     // H: 診断回答
        ]],
      },
    });

    // ── Resend メール通知 ──────────────────────────────────────
    if (RESEND_KEY) {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from:    'noreply@nexccess.com',
        to:      NOTIFY_TO,
        subject: `【salon楓 AI診断】${name} 様より予約リクエスト`,
        html: `
          <h2>【salon楓】新規AI診断・予約リクエスト</h2>
          <table border="1" cellpadding="6" style="border-collapse:collapse;">
            <tr><th>送信日時</th><td>${now}</td></tr>
            <tr><th>お名前</th><td>${name}</td></tr>
            <tr><th>メールアドレス</th><td>${email}</td></tr>
            <tr><th>おすすめメニュー</th><td>${recommended_menu}</td></tr>
            <tr><th>スコア / レベル</th><td>${score} / ${level}</td></tr>
            <tr><th>診断回答</th><td>${answersStr}</td></tr>
          </table>
        `,
      });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[save-shigyou]', err);
    return res.status(500).json({ error: err.message });
  }
};
