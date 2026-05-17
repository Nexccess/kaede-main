// api/save-shigyou.js
// salon楓 / Path-Flow標準 / 携帯・日時フィールド対応版
// ============================================================
const { google } = require('googleapis');

const SHEET_NAME     = 'AI診断結果';
const SPREADSHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;
const SA_JSON        = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      lp               = '',
      name             = '',
      phone            = '',
      email            = '',
      date             = '',
      date2            = '',
      recommended_menu = '',
      score            = '',
      level            = '',
      answers          = [],
    } = req.body;

    const now        = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const answersStr = Array.isArray(answers) ? answers.join(' / ') : String(answers);

    const credentials = JSON.parse(SA_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー確認・自動挿入
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:K1`,
    });
    if (!existing.data.values || existing.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            '送信日時','LP_ID','お名前','携帯電話','メールアドレス',
            '希望日時（第1）','希望日時（第2）','おすすめメニュー','スコア','レベル','診断回答'
          ]],
        },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now, lp, name, phone, email,
          date, date2, recommended_menu, score, level, answersStr
        ]],
      },
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[save-shigyou]', err);
    return res.status(500).json({ error: err.message });
  }
};
