// api/save-shigyou.js  ─  採用フォーム統合処理  (Ver 3.4 / kaede-corp)
// SS書込み（必須）+ Googleカレンダー仮登録（非致命的）+ Nodemailer Gmailメール通知（非致命的）
// ※カレンダー/メール失敗はログのみ。SS書込み成功なら200を返す。

"use strict";

const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const SHEET_NAME   = "採用問い合わせ";
const NOTIFY_EMAIL = "info.kaedesalon@gmail.com";

function getAuth() {
  const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: json,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar",
    ],
  });
}

// ── SS書込み（必須） ────────────────────────────────
async function appendToSheet(auth, payload) {
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SHIGYOU_SPREADSHEET_ID;

  const checkRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:K1`,
  });
  if (!checkRes.data.values || checkRes.data.values.length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["送信日時","LP_ID","お名前","携帯電話","メールアドレス","希望日時（第1）","希望日時（第2）","おすすめポジション","スコア","レベル","診断回答"]],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        payload.now,
        payload.lp,
        payload.name,
        payload.phone,
        payload.email,
        payload.date,
        payload.date2 || "",
        payload.recommended_menu || "",
        payload.score  !== undefined ? String(payload.score)  : "",
        payload.level  || "",
        payload.answersStr || "",
      ]],
    },
  });
}

// ── カレンダー登録（非致命的） ──────────────────────
async function tryInsertCalendar(auth, payload) {
  try {
    const calendarId = process.env.CALENDAR_ID;
    if (!calendarId || !payload.date) return;

    const calendar = google.calendar({ version: "v3", auth });
    // payload.date = "yyyy-mm-dd 時間帯" → "yyyy-mm-dd" のみ切り出し
    const dateOnly = payload.date.split(" ")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      console.warn("[calendar] 日付フォーマット不正・スキップ:", payload.date);
      return;
    }

    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `【仮予約・採用面談】${payload.name} 様`,
        description: `ポジション: ${payload.recommended_menu}\nスコア: ${payload.score} (${payload.level})\nTEL: ${payload.phone}\nEmail: ${payload.email}`,
        start: { date: dateOnly },
        end:   { date: dateOnly },
      },
    });
    console.log("[calendar] 登録成功:", dateOnly);
  } catch (err) {
    // カレンダー失敗は全体を止めない
    console.warn("[calendar] 登録失敗（非致命的）:", err.message);
  }
}

// ── Gmailメール通知（非致命的） ─────────────────────
async function trySendMail(payload) {
  try {
    const gmailUser = process.env.GMAIL_USER || NOTIFY_EMAIL;
    const appPass   = process.env.GMAIL_APP_PASSWORD;
    if (!appPass) {
      console.warn("[mail] GMAIL_APP_PASSWORD 未設定・スキップ");
      return;
    }

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: appPass },
    });

    await transport.sendMail({
      from: `"楓salon 採用システム" <${gmailUser}>`,
      to:   NOTIFY_EMAIL,
      subject: `【採用問い合わせ】${payload.name} 様 (${payload.level})`,
      text: `
新しい採用問い合わせが届きました。

■ お名前        : ${payload.name}
■ 携帯電話      : ${payload.phone}
■ メールアドレス: ${payload.email}
■ 面談希望日（第1）: ${payload.date}
■ 面談希望日（第2）: ${payload.date2 || "未入力"}
■ おすすめポジション: ${payload.recommended_menu}
■ スコア        : ${payload.score} / レベル: ${payload.level}
■ 診断回答      : ${payload.answersStr}

送信日時: ${payload.now}
      `.trim(),
    });
    console.log("[mail] 送信成功:", NOTIFY_EMAIL);
  } catch (err) {
    // メール失敗は全体を止めない
    console.warn("[mail] 送信失敗（非致命的）:", err.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    const {
      lp, name, phone, email,
      date, date2,
      recommended_menu, score, level,
      answers,
    } = body;

    // answers: 配列 or 文字列 → 文字列に統一（Sheets Invalid list_value 防止）
    const answersStr = Array.isArray(answers)
      ? answers.join(" / ")
      : (typeof answers === "string" ? answers : "");

    // JST 日時（ハイフン形式）
    const now = new Date()
      .toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      .replace(/\//g, "-");

    const payload = {
      now,
      lp:   lp || "kaede-recruit-v1",
      name, phone, email,
      date,
      date2: date2 || "",
      recommended_menu,
      score,
      level,
      answersStr,
    };

    const auth = getAuth();

    // SS書込み（必須・失敗なら500）
    await appendToSheet(auth, payload);

    // カレンダー・メールは並列実行だが失敗しても200を返す
    await Promise.all([
      tryInsertCalendar(auth, payload),
      trySendMail(payload),
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[save-shigyou] 致命的エラー:", err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
