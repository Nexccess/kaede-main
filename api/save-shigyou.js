// api/save-shigyou.js  ─  kaede-main 顧客予約処理  (fix / 2026-05)
// SHEET_NAME=AI診断結果, ensureSheet自動作成, Promise.allSettled, App PW スペース除去
"use strict";

const { google } = require("googleapis");
const nodemailer  = require("nodemailer");

const SHEET_NAME   = "AI診断結果";
const NOTIFY_EMAIL = "info.kaedesalon@gmail.com";

const HEADERS = [
  "送信日時","LP_ID","お名前","携帯電話","メールアドレス",
  "希望日時（第1）","希望日時（第2）","おすすめメニュー",
  "スコア","レベル","診断回答",
];

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

// ── シート存在確認→なければ作成→ヘッダー自動挿入 ──
async function ensureSheet(sheets, spreadsheetId) {
  const meta   = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    return;
  }

  const check = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:K1`,
  });
  if (!check.data.values || check.data.values.length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
}

// ── SS書込み（必須） ─────────────────────────────
async function appendToSheet(auth, payload) {
  const sheets        = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SHIGYOU_SPREADSHEET_ID;

  await ensureSheet(sheets, spreadsheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        payload.now, payload.lp,
        payload.name, payload.phone, payload.email,
        payload.date, payload.date2 || "",
        payload.recommended_menu || "",
        payload.score !== undefined ? String(payload.score) : "",
        payload.level || "",
        payload.answersStr || "",
      ]],
    },
  });
}

// ── カレンダー登録（非致命的） ──────────────────
async function tryInsertCalendar(auth, payload) {
  const calendarId = process.env.CALENDAR_ID;
  if (!calendarId || !payload.date) return;
  const dateOnly = payload.date.split(" ")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return;
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary:     `【仮予約】${payload.name} 様`,
      description: `メニュー: ${payload.recommended_menu}\nスコア: ${payload.score} (${payload.level})\nTEL: ${payload.phone}\nEmail: ${payload.email}`,
      start: { date: dateOnly },
      end:   { date: dateOnly },
    },
  });
}

// ── Gmailメール通知（非致命的） ─────────────────
async function trySendMail(payload) {
  const rawPass = process.env.GMAIL_APP_PASSWORD;
  if (!rawPass) { console.warn("[mail] GMAIL_APP_PASSWORD 未設定"); return; }

  // Googleのアプリパスワードはスペース区切り表示のため除去
  const appPass   = rawPass.replace(/\s+/g, "");
  const gmailUser = (process.env.GMAIL_USER || NOTIFY_EMAIL).trim();

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: appPass },
  });

  await transport.sendMail({
    from:    `"楓salon 予約システム" <${gmailUser}>`,
    to:      NOTIFY_EMAIL,
    subject: `【新規予約】${payload.name} 様 (Lv.${payload.level})`,
    text: [
      "新しい予約が届きました。",
      "",
      `■ お名前        : ${payload.name}`,
      `■ 携帯電話      : ${payload.phone}`,
      `■ メールアドレス: ${payload.email}`,
      `■ 希望日時（第1）: ${payload.date}`,
      `■ 希望日時（第2）: ${payload.date2 || "未入力"}`,
      `■ おすすめメニュー: ${payload.recommended_menu}`,
      `■ スコア        : ${payload.score} / Lv: ${payload.level}`,
      "",
      `送信日時: ${payload.now}`,
    ].join("\n"),
  });
  console.log("[mail] 送信完了 →", NOTIFY_EMAIL);
}

// ── メインハンドラ ────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const {
      lp, name, phone, email,
      date, date2,
      recommended_menu, score, level,
      answers,
    } = req.body || {};

    const answersStr = Array.isArray(answers)
      ? answers.join(" / ")
      : (typeof answers === "string" ? answers : "");

    const now = new Date()
      .toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      .replace(/\//g, "-");

    const payload = {
      now, lp: lp || "kaede-v1",
      name, phone, email,
      date, date2: date2 || "",
      recommended_menu, score, level, answersStr,
    };

    const auth = getAuth();

    // SS書込み（必須 / 失敗→500）
    await appendToSheet(auth, payload);

    // カレンダー・メール: allSettled で完全封じ込め
    const results = await Promise.allSettled([
      tryInsertCalendar(auth, payload),
      trySendMail(payload),
    ]);
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn(`[save-shigyou] 非致命的エラー[${["calendar","mail"][i]}]:`, r.reason?.message);
      }
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[save-shigyou] 致命的エラー:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
