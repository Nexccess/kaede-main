// api/diagnose.js
// salon楓 AI診断 / Gemini 2.5 Flash Lite
// ============================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = 'gemini-2.5-flash-lite';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { answers = [] } = req.body;

    const QUESTIONS = [
      '最も気になる部位はどこですか？',
      '脱毛のご経験を教えてください',
      'ご希望の施術スタイルは？',
      'お肌や痛みのお悩みはありますか？',
      'ご来店しやすい時間帯は？',
    ];

    const answersText = QUESTIONS
      .map((q, i) => `Q${i + 1}. ${q}\n→ ${answers[i] || '未回答'}`)
      .join('\n');

    const prompt = `
あなたはsalon楓（東京・東浅草）のメンズ脱毛サロンのAIカウンセラーです。
以下の診断回答をもとに、最適なメニューを提案してください。

【salon楓 メニュー一覧（税込）】
- Sパーツ単品（5分）: ¥700　鼻下・あご・唇下・ほほ・首・眉上・手足の指 など
- Mパーツ単品（10分）: ¥1,400　わき・鎖骨・肩・うなじ・Vライン上 など
- MLパーツ単品（20分）: ¥2,800　ヒジ上下・胸・腹
- Lパーツ単品（30分）: ¥4,200　背中上下・おしり・VIO各ライン
- LLパーツ単品（35分）: ¥4,900　太もも・ヒザ下
- 顔のみコース（25分）: ¥3,000
- VIO（25分）: ¥4,000
- 40分 freeコース（初回限定）: ¥5,000（通常¥6,000）
- 60分 freeコース: ¥10,000（初回¥8,000）
- 全身脱毛コース（120分）: ¥11,000　※顔含む、VIO・二の腕・背中除く

【診断回答】
${answersText}

【出力形式】必ずJSON形式のみで返してください。前置き・コメント・マークダウン不要。

{
  "message": "お客様への一言コメント（2文程度・親しみやすく）",
  "recommended_menu": "メニュー名",
  "recommended_price": "¥XXXX（XX分）",
  "reason": "このメニューをおすすめする理由（2〜3文）",
  "score": 数値（50〜100）,
  "level": "A" または "B" または "C"
}

scoreとlevelの基準:
- A（85以上）: 全身・freeコース等、まとまった施術意欲が高い
- B（70〜84）: 特定部位・中程度の意欲
- C（69以下）: お試し・1部位のみ
`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
        },
      }),
    });

    if (!geminiRes.ok) throw new Error(`Gemini API error: ${geminiRes.status}`);

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // JSON抽出（マークダウン除去）
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const result  = JSON.parse(cleaned);

    return res.status(200).json(result);

  } catch (err) {
    console.error('[diagnose]', err);
    return res.status(500).json({ error: err.message });
  }
};
