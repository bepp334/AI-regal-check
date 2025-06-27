
import React, { useState, useEffect } from 'react';
import { AdCheckStep, OCRVerificationItem, StepKey } from '../types';

interface StepResultDisplayProps {
  currentAppStep: AdCheckStep;
  getStepData: (stepKey: StepKey) => string | null;
  updateStepData: (stepKey: StepKey, value: string) => void;
  step2NeedsVerification: boolean;
  onOcrVerificationSubmit: () => void;
  onProceedToFinalProcessing: () => void;
  onRecheck: () => void;
  recheckPrompt: string;
  setRecheckPrompt: (prompt: string) => void;
  finalAdTextForRecheck: string | null; // Used to determine if re-check is possible
}

interface TableRow {
  [key: string]: string;
}

function parseMarkdownTable(markdown: string): TableRow[] | null {
  const lines = markdown.trim().split('\n').map(line => line.trim());
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const separatorLine = lines[1];

  if (!headerLine.startsWith('|') || !headerLine.endsWith('|') ||
      !separatorLine.startsWith('|') || !separatorLine.endsWith('|') ||
      !separatorLine.includes('---')) {
    return null; 
  }

  const headers = headerLine.split('|').slice(1, -1).map(h => h.trim());
  if (headers.length === 0) return null;

  const rows: TableRow[] = [];

  for (let i = 2; i < lines.length; i++) {
    const rowLine = lines[i];
    if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) continue; 

    const cells = rowLine.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== headers.length && cells.length > 0) { 
        if (cells.every(c => c === '')) continue; 
        const row: TableRow = {};
        headers.forEach((header, index) => {
          row[header] = cells[index] || ''; 
        });
        rows.push(row);
        continue;
    }
    if(cells.length === 0 && headers.length > 0) continue;

    const row: TableRow = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || '';
    });
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

const RenderMarkdownReport: React.FC<{ report: string }> = React.memo(({ report }) => {
  const elements: React.ReactNode[] = [];
  const lines = report.trim().split('\n');
  let currentTableLines: string[] = [];
  let currentParagraphLines: string[] = [];

  function flushParagraph(keySuffix: string | number) {
    if (currentParagraphLines.length > 0) {
      elements.push(
        <pre key={`p-${keySuffix}-${elements.length}`} className="whitespace-pre-wrap break-words text-sm text-slate-300 bg-slate-800/60 p-3 rounded-md shadow leading-relaxed mb-3">
          {currentParagraphLines.join('\n')}
        </pre>
      );
      currentParagraphLines = [];
    }
  }

  function flushTable(keySuffix: string | number) {
    if (currentTableLines.length > 0) {
      const tableData = parseMarkdownTable(currentTableLines.join('\n'));
      if (tableData && tableData.length > 0 && Object.keys(tableData[0]).length > 0) {
        elements.push(
          <div key={`table-wrapper-${keySuffix}-${elements.length}`} className="overflow-x-auto mb-4">
            <table className="min-w-full divide-y divide-slate-600 border border-slate-600 border-collapse text-xs sm:text-sm">
              <thead className="bg-slate-700">
                <tr>
                  {Object.keys(tableData[0]).map((header, hIdx) => (
                    <th key={`${header}-${hIdx}`} scope="col" className="px-3 py-2 text-left font-semibold text-slate-200 uppercase tracking-wider">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-slate-800 divide-y divide-slate-600">
                {tableData.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/70'}>
                    {Object.values(row).map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 whitespace-pre-wrap text-slate-300 break-words">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      } else { 
        currentParagraphLines.push(...currentTableLines);
        flushParagraph(`table-fallback-${keySuffix}`);
      }
      currentTableLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      flushParagraph(i);
      flushTable(i);
      elements.push(<h2 key={`h2-${i}-${elements.length}`} className="text-2xl font-bold text-purple-300 mt-6 mb-3">{line.substring(3)}</h2>);
    } else if (line.startsWith('### ')) {
      flushParagraph(i);
      flushTable(i);
      elements.push(<h3 key={`h3-${i}-${elements.length}`} className="text-xl font-semibold text-purple-400 mt-4 mb-2">{line.substring(4)}</h3>);
    } else if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushParagraph(i); 
      currentTableLines.push(line);
    } else {
      flushTable(i); 
      if (line.trim() !== '' || currentParagraphLines.length > 0) {
          currentParagraphLines.push(line);
      }
    }
  }
  flushParagraph('final-p'); 
  flushTable('final-t'); 

  return <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none prose-invert">{elements}</div>;
});


export const StepResultDisplay: React.FC<StepResultDisplayProps> = ({
  currentAppStep,
  getStepData,
  updateStepData,
  step2NeedsVerification,
  onOcrVerificationSubmit,
  onProceedToFinalProcessing,
  onRecheck,
  recheckPrompt,
  setRecheckPrompt,
  finalAdTextForRecheck,
}) => {
  const [editableOcrText, setEditableOcrText] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<string>('');

  useEffect(() => {
    setEditableOcrText(getStepData('step2CorrectedOcrText') || getStepData('step2RawOcrText') || '');
  }, [currentAppStep, getStepData]);

  const handleOcrTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditableOcrText(event.target.value);
    updateStepData('step2CorrectedOcrText', event.target.value);
  };
  
  const handleCopyToClipboard = async () => {
    const reportText = getStepData('step4FinalReport');
    if (reportText) {
      try {
        await navigator.clipboard.writeText(reportText);
        setCopyStatus('コピーしました！');
        setTimeout(() => setCopyStatus(''), 2000);
      } catch (err) {
        setCopyStatus('コピーに失敗しました。');
        console.error('クリップボードへのコピーに失敗:', err);
        setTimeout(() => setCopyStatus(''), 2000);
      }
    }
  };

  const renderSimpleContent = (title: string, dataKey: StepKey | StepKey[]) => {
    const keys = Array.isArray(dataKey) ? dataKey : [dataKey];
    const dataArray = keys.map(k => getStepData(k)).filter(d => d !== null && d.trim() !== '');
    if (dataArray.length === 0) return null;

    const content = dataArray.join('\n\n---\n\n');

    return (
      <div className="mb-6 p-4 border border-slate-700 rounded-lg bg-slate-800/50">
        <h3 className="text-xl font-semibold text-purple-400 mb-3">{title}</h3>
        <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 bg-slate-700/50 p-3 rounded-md shadow leading-relaxed">{content}</pre>
      </div>
    );
  };

  const showStep1 = currentAppStep >= AdCheckStep.ProcessingStep1Step2 && (getStepData('step1CsvText') || getStepData('step1DetectedUrls') || getStepData('step1ClientInfo'));
  const showStep2 = currentAppStep >= AdCheckStep.ProcessingStep1Step2 && (getStepData('step2RawOcrText') || getStepData('step2CorrectedOcrText'));
  const showStep3 = currentAppStep >= AdCheckStep.ProcessingStep3Step4 && getStepData('step3FactBase');
  const showStep4 = currentAppStep === AdCheckStep.Complete && getStepData('step4FinalReport');


  return (
    <div className="mt-6 space-y-6">
      { showStep1 && 
        renderSimpleContent("ステップ1: 抽出された広告テキスト", ['step1CsvText', 'step1DetectedUrls', 'step1ClientInfo'])
      }

      { showStep2 && (
        <div className="mb-6 p-4 border border-slate-700 rounded-lg bg-slate-800/50">
          <h3 className="text-xl font-semibold text-purple-400 mb-3">ステップ2: OCR結果</h3>
          {currentAppStep === AdCheckStep.OCRVerification || (currentAppStep === AdCheckStep.ReviewStep1Step2 && step2NeedsVerification) ? (
            <>
              <p className="text-yellow-400 mb-2 text-sm">
                OCR処理により、いくつかの曖昧な箇所が特定されました。必要に応じて以下のテキストを確認・修正してください。
                （システムプロンプトでは「[不明箇所1]: 何と記載されていますか？」といった質問形式が指定されていますが、
                このUIでは簡略化のため、下のテキストエリアでOCRテキスト全体を直接編集して修正してください。）
              </p>
              <textarea
                value={editableOcrText}
                onChange={handleOcrTextChange}
                rows={10}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 text-slate-100 placeholder-slate-400"
                aria-label="編集可能なOCRテキスト"
              />
              <button
                onClick={onOcrVerificationSubmit}
                className="mt-4 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
              >
                OCRテキストを確定
              </button>
            </>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 bg-slate-700/50 p-3 rounded-md shadow leading-relaxed">
                {getStepData('step2CorrectedOcrText') || getStepData('step2RawOcrText')}
            </pre>
          )}
        </div>
      )}

      { currentAppStep === AdCheckStep.ReviewStep1Step2 && !step2NeedsVerification && (
         <button
            onClick={onProceedToFinalProcessing}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-md transition duration-150 ease-in-out text-lg"
          >
            事実確認と最終レポート作成へ進む
        </button>
      )}


      { showStep3 && 
         <div className="mb-6 p-4 border border-slate-700 rounded-lg bg-slate-800/50">
          <h3 className="text-xl font-semibold text-purple-400 mb-3">ステップ3: 事実確認サマリー</h3>
           <RenderMarkdownReport report={getStepData('step3FactBase')!} />
        </div>
      }

      { showStep4 && 
        <div className="mb-6 p-4 border border-slate-700 rounded-lg bg-slate-800/50">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600 mb-4 text-center">ステップ4: 最終広告チェックレポート</h2>
          <RenderMarkdownReport report={getStepData('step4FinalReport')!} />
          <div className="mt-6 text-center">
            <button
                onClick={handleCopyToClipboard}
                className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
            >
                レポートをクリップボードにコピー
            </button>
            {copyStatus && <p className="text-sm text-green-400 mt-2">{copyStatus}</p>}
          </div>
        </div>
      }
      
      {currentAppStep === AdCheckStep.Error && (
          <p className="text-center text-red-400 font-semibold">エラーが発生しました。上記メッセージおよび部分的な結果を確認してください。</p>
      )}
      {currentAppStep === AdCheckStep.Complete && (
        <>
          <p className="text-center text-green-400 font-semibold text-2xl py-4">🎉 広告チェック処理が正常に完了しました！ 🎉</p>
          {finalAdTextForRecheck && (
            <div className="mt-8 p-4 border border-slate-700 rounded-lg bg-slate-800/50">
              <h3 className="text-xl font-semibold text-amber-400 mb-3">再チェック</h3>
              <p className="text-slate-300 text-sm mb-2">
                現在の結果に対して追加の指示やフィードバックがある場合は、以下に入力して再チェックを実行できます。
                AIはあなたの入力を考慮して、再度評価を行います。
              </p>
              <textarea
                value={recheckPrompt}
                onChange={(e) => setRecheckPrompt(e.target.value)}
                rows={4}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-amber-500 focus:border-amber-500 text-slate-100 placeholder-slate-400"
                placeholder="例: 「○○の箇所は△△という解釈もできるため問題ないはずです。再検討してください。」"
              />
              <button
                onClick={onRecheck}
                className="mt-4 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out"
              >
                再チェックを実行
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
