
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { GeminiStage1Response, GeminiStage2Response } from '../types';

if (!process.env.API_KEY) {
  console.error("API_KEY environment variable is not set. Please ensure it's configured in the execution environment.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "fallback_or_handle_error_gracefully" });
const GEMINI_MODEL_NAME = 'gemini-2.5-flash-preview-04-17';

interface Stage1Params {
  mainSystemPrompt: string;
  adTextCsvFileContent: string | null;
  adTextDirect: string;
  adTextImagesBase64: string[] | null; 
  adCreativeImagesBase64: string[] | null; // Array of base64 for ad creative images
  isCsvInput: boolean; 
  hasDirectTextInput: boolean;
}

interface Stage2Params {
  mainSystemPrompt: string;
  knowledgeBase1: string;
  knowledgeBase2: string;
  knowledgeBase3: string;
  finalAdText: string;
  referenceUrls: string;
  clientSharedInfo: string;
  recheckPrompt: string | null;
}

const runStage1_AdTextAndOCR = async (params: Stage1Params): Promise<GeminiStage1Response> => {
  const { 
    mainSystemPrompt, 
    adTextCsvFileContent, 
    adTextDirect, 
    adTextImagesBase64,
    adCreativeImagesBase64, 
    isCsvInput,
    hasDirectTextInput
  } = params;

  let inputTextPart = "";
  if (isCsvInput && adTextCsvFileContent) {
    inputTextPart = `ユーザーは広告テキストとしてCSVファイルを提供しました。内容は以下の通りです:\n\`\`\`csv\n${adTextCsvFileContent}\n\`\`\`\nこのCSVを解析し、「===== CSV_TEXT_START =====」ブロックを生成してください。`;
  } else if (hasDirectTextInput && adTextDirect) {
    inputTextPart = `ユーザーは広告テキスト、URL、および可能性としてクライアント共有情報を含む以下のテキストを直接入力しました:\n\`\`\`\n${adTextDirect}\n\`\`\`\nこのテキストを処理し、「===== CSV_TEXT_START =====」ブロックを生成し、検出されたURLとクライアント情報をリストアップしてください。`;
  } else {
    inputTextPart = "ユーザーはCSVファイルもテキスト直接入力も行いませんでした。広告テキスト画像が提供されている場合は、それらが主要なテキストソースとなる可能性があります。「===== CSV_TEXT_START =====」ブロックは空または広告テキスト画像の内容に基づいて適切に処理してください。";
  }
  
  const contents: Part[] = [];
  let imagePromptParts = "";
  let hasAnyImage = false;

  if ((adTextImagesBase64 && adTextImagesBase64.length > 0) || (adCreativeImagesBase64 && adCreativeImagesBase64.length > 0)) {
    hasAnyImage = true;
    imagePromptParts += `\n\nユーザーは以下の画像を提供しました:\n`;
    if (adTextImagesBase64 && adTextImagesBase64.length > 0) {
      imagePromptParts += `- 広告テキストのスクリーンショットとして ${adTextImagesBase64.length} 枚の画像。\n`;
      adTextImagesBase64.forEach((base64Str, index) => {
        const mimeTypeMatch = base64Str.match(/^data:(image\/(?:png|jpeg|webp));base64,/);
        if (!mimeTypeMatch) throw new Error(`広告テキスト画像 ${index + 1} の無効なBase64文字列です: MIMEタイプが見つからないかサポートされていません。`);
        const mimeType = mimeTypeMatch[1];
        const base64Data = base64Str.substring(mimeTypeMatch[0].length);
        contents.push({ inlineData: { mimeType, data: base64Data } });
      });
    }
    if (adCreativeImagesBase64 && adCreativeImagesBase64.length > 0) {
      imagePromptParts += `- 広告クリエイティブとして ${adCreativeImagesBase64.length} 枚の画像。\n`;
      adCreativeImagesBase64.forEach((base64Str, index) => {
        const mimeTypeMatch = base64Str.match(/^data:(image\/(?:png|jpeg|webp));base64,/);
        if (!mimeTypeMatch) throw new Error(`広告クリエイティブ画像 ${index + 1} の無効なBase64文字列です: MIMEタイプが見つからないかサポートされていません。`);
        const mimeType = mimeTypeMatch[1];
        const base64Data = base64Str.substring(mimeTypeMatch[0].length);
        contents.push({ inlineData: { mimeType, data: base64Data } });
      });
    }
    imagePromptParts += `これらのすべての画像に対してOCRを実行してください。\n`;
    imagePromptParts += `認識されたすべてのテキストを、画像間の区切りや「画像N:」のような接頭辞を一切含めずに、単一の連続したテキストブロックとして結合してください。\n`;
    imagePromptParts += `この結合されたOCR結果のみを「===== OCR_TEXT_START =====」と「===== OCR_TEXT_END =====」の間に配置してください。\n`;
    imagePromptParts += `例:\n広告テキスト画像1の内容が「こんにちは」、広告クリエイティブ画像1の内容が「世界」の場合、出力は以下のようになります:\n`;
    imagePromptParts += `\`\`\`\n===== OCR_TEXT_START =====\nこんにちは\n世界\n===== OCR_TEXT_END =====\n\`\`\`\n\n`;
    imagePromptParts += `通常通り、OCR品質チェック結果と、ユーザー確認が必要な場合の「⚠️ OCR確認が必要な場合」セクション（具体的な質問を含む）も、この結合されたテキスト全体に基づいて生成してください。`;
  }

  if (hasAnyImage) {
     inputTextPart += `\n\nOCR処理について:\n${imagePromptParts}`;
  } else {
    inputTextPart += `\n\nOCR処理について: OCR対象の画像は提供されませんでした。「OCR_TEXT_START」ブロックには「OCR対象の画像はありませんでした。」のように記述してください。「OCR品質チェック結果」および「⚠️ OCR確認が必要な場合」のセクションも適切に処理してください。`;
  }
  
  const instructionToStop = "\n\n重要: ステップ2のOCR出力（ユーザー確認プロンプトがある場合はそれを含む）の最後までを実行し、その後停止してください。内部統合処理やステップ3にはまだ進まないでください。";
  const fullPromptForStage1 = `${mainSystemPrompt}\n\n処理指示:\n${inputTextPart}\n\n${instructionToStop}`;
  
  contents.unshift({ text: fullPromptForStage1 });

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: contents,
    });
    return { text: response.text };
  } catch (e) {
    console.error("Gemini API ステージ1でのエラー:", e);
    if (e instanceof Error) {
        throw new Error(`Gemini API リクエスト失敗 (ステージ1): ${e.message}`);
    }
    throw new Error("不明な Gemini API エラー (ステージ1)");
  }
};


const runStage2_FactFindAndReport = async (params: Stage2Params): Promise<GeminiStage2Response> => {
  const { 
    mainSystemPrompt, 
    knowledgeBase1, 
    knowledgeBase2, 
    knowledgeBase3,
    finalAdText,
    referenceUrls,
    clientSharedInfo,
    recheckPrompt
  } = params;

  let contextMessage = `
あなたは既にステップ1とステップ2のOCR部分を完了しています。
最終的な \`ad_text\` (CSV/直接入力と確認済みOCRから結合されたもの) は以下の通りです:
\`\`\`
${finalAdText}
\`\`\`

ユーザーから提供された参照URLは: ${referenceUrls || '提供なし'}
ユーザーから提供されたクライアント共有情報は: ${clientSharedInfo || '提供なし'}
`;

  if (recheckPrompt) {
    contextMessage += `
--------------------------------------------------
**重要: 再チェック指示**

以前の分析（ステップ3およびステップ4）は完全に破棄してください。
ユーザーから以下の追加の入力/フィードバックが提供されました。この新しい情報を最優先し、これに基づいて**完全に新しい**ステップ3（事実情報取得）とステップ4（チェックリスト評価＆最終レポート）を生成してください。

ユーザーフィードバック:
「${recheckPrompt}」

この新しいフィードバックと、上記の変更されていない \`finalAdText\`、参照URL、クライアント共有情報、および提供されたナレッジベース（①、②、③）を使用して、評価をゼロからやり直してください。
以前のレポート内容に影響されない、完全に独立した新しい分析結果を期待しています。
--------------------------------------------------
`;
  }

  contextMessage += `

**特に「KNOWLEDGE_BASE_2_LINE_GUIDELINES」（LINE広告審査ガイドライン）のチェックに関して、以下の指示を厳守してください:**
- ガイドライン内のNG例（例: 「公式LINEアカウント」など）は、あくまで「このような表記がNGである」というルールの説明です。これらがユーザーの \`ad_text\` 内に存在すると早合点しないでください。
- **ユーザー提供の \`ad_text\` 内に、ガイドライン違反の具体的な文言が実際に存在する場合にのみ、「NG」として指摘してください。**
- **NGと判断した場合、必ず「指摘事項」の列に、\`ad_text\` から問題のある箇所を正確に引用してください。引用なしに一般的な指摘（例：「『公式LINEアカウント』という表記があります」など）をしないでください。\`ad_text\` 内に該当する具体的な文言が見つからない場合は、その項目はNGとして指摘しないでください。**
- 例えば、\`ad_text\` に「LINE」という単語しか含まれていない場合、「LINE公式アカウント」という具体的なNG表記が存在しない限り、関連する指摘を行うべきではありません。
- 提供された \`ad_text\` の内容を注意深く確認し、思い込みや早合点をせず、実際に書かれていることのみを評価対象としてください。

これから、以下の処理を続行してください:
1. まだ \`ad_text\` を完全に統合済みとして扱っていない場合は、ステップ2の「--- 内部統合処理（確認後実行）---」部分を実行してください。上記で提供された \`ad_text\` はこの統合の結果です。
2. 次に、この \`ad_text\` と提供された参照URLおよびクライアント共有情報を使用して、ステップ3（事実情報取得）を実行してください。指示通り、参照URLにはあなたのウェブブラウジング能力（Google検索経由）を活用してください。
3. 最後に、ステップ3で得られた事実情報データベースと生成された \`ad_text\` を使用して、ステップ4（チェックリスト評価＆最終レポート）を実行してください。このステップでは、追加されたナレッジベース（①、②、③）を厳密に使用してください。

元のシステムプロンプトで指定された通り、ステップ3の結果とステップ4の完全な最終レポートを出力してください。
`;

  const fullPromptForStage2 = `${mainSystemPrompt}\n\n${knowledgeBase1}\n\n${knowledgeBase2}\n\n${knowledgeBase3}\n\n${contextMessage}`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: [{text: fullPromptForStage2}],
        config: { // リアルタイムでのウェブ情報取得のためにGoogle Searchツールを有効化
          tools: [{googleSearch: {}}],
        }
    });
    return { text: response.text };
  } catch (e) {
    console.error("Gemini API ステージ2でのエラー:", e);
    if (e instanceof Error) {
        throw new Error(`Gemini API リクエスト失敗 (ステージ2): ${e.message}`);
    }
    throw new Error("不明な Gemini API エラー (ステージ2)");
  }
};


export const geminiService = {
  runStage1_AdTextAndOCR,
  runStage2_FactFindAndReport,
};
