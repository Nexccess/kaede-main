// api/diagnose.js — Path-Flow v3.2 | kaede salon
// Gemini 3-model fallback: flash-lite → 1.5-flash → 1.5-flash-8b

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
];

const MENU_LIST = `
【kaede 楓 salon メンズ脱毛メニュー（税込・都度払い）】
- Sパーツ（鼻下・あご・顎下・首など）: ¥700〜/部位
- Mパーツ（わき・うなじ・Vライン上など）: ¥1,400/部位
- MLパーツ（胸・腹・ヒジ上下など）: ¥2,800/部位
- Lパーツ（背中・おしり・VIOなど）: ¥4,200/部位
- 全身脱毛（VIOなし・120分）: ¥11,000（人気No.1）
- 顔のみ（25分）: ¥3,000
- VIO（25分）: ¥4,000
- 脱毛freeコース30分: 時間内好きな部位を何パーツでも
- 脱毛freeコース60分: 時間内好きな部位を何パーツでも
`;

const SYSTEM_PROMPT = `あなたはメンズ脱毛サロン「kaede 楓 salon」のAI診断アシスタントです。
ユーザーの5つの回答を分析し、最適なメニューをJSON形式で返してください。

${MENU_LIST}

レスポンスは必ず以下のJSON形式のみ（前後のテキスト・コードブロック不要）：
{
  "recommended_menu": "メニュー名",
  "price": "料金表記（例: ¥11,000/回）",
  "score": 数値(0-100),
  "level": "A" or "B" or "C",
  "reason": "推奨理由（2〜3文、100文字以内）"
}

levelの基準: A=スコア85以上（最優先で取り組むべき）, B=75以上（効果が高い）, C=74以下（まず試すのに最適）`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { answers } = req.body || {};
  if (!answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const userPrompt = `以下のユーザー回答を分析してください：\n${answers.map((a, i) => `Q${i+1}: ${a}`).join('\n')}`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json(getFallback(answers));
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT
      });
      const result = await model.generateContent(userPrompt);
      const text = result.response.text().replace(/```json|```/g, '').trim();
      const data = JSON.parse(text);

      // Validate required fields
      if (!data.recommended_menu || !data.score || !data.level) throw new Error('Invalid response shape');

      return res.status(200).json(data);
    } catch (err) {
      const is503 = err.message && (err.message.includes('503') || err.message.includes('overloaded'));
      if (!is503 && modelName !== MODELS[MODELS.length - 1]) {
        // Non-503 error on non-final model: still try next
      }
      // Continue to next model
    }
  }

  // All models failed: rule-based fallback
  return res.status(200).json(getFallback(answers));
};

function getFallback(answers) {
  const part = answers[0] || '';
  if (part.includes('全身')) {
    return { recommended_menu: '全身脱毛（VIOなし）', price: '¥11,000/回', score: 88, level: 'A', reason: '全身をまとめてケアしたい方に最適です。120分・人気No.1メニュー。都度払いなのでコース不要でお試しいただけます。' };
  } else if (part.includes('VIO')) {
    return { recommended_menu: 'VIO脱毛', price: '¥4,000/回', score: 80, level: 'B', reason: 'VIOは繊細なケアが必要な部位です。熟練スタッフが丁寧に対応いたします。都度払いで気軽にスタートできます。' };
  } else if (part.includes('ひげ') || part.includes('顔')) {
    return { recommended_menu: '顔のみ（鼻下・あご・顎下）', price: '¥700〜/部位', score: 75, level: 'B', reason: 'ひげ脱毛はSパーツ単位で部位を選べます。まずは気になる部位だけお試しください。' };
  } else if (part.includes('脇') || part.includes('腕')) {
    return { recommended_menu: 'Mパーツ（わき・腕）', price: '¥1,400/部位', score: 74, level: 'C', reason: '清潔感を求める方に人気の部位です。都度払いで負担なく始められます。' };
  } else {
    return { recommended_menu: 'MLパーツ（胸・腹・背中）', price: '¥2,800/部位', score: 76, level: 'B', reason: '体幹部のケアをご希望の方に最適です。施術時間の目安は部位ごとに約15〜25分です。' };
  }
}
