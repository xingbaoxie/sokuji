import React from 'react';
import type { RecordingSummaryResult } from '../types/recording';
import { RecordingResultDialog } from './RecordingResultDialog';

export function SummaryReportDialog({ result, onClose, onExport }: { result: RecordingSummaryResult; onClose: () => void; onExport: (type: 'report-txt' | 'report-docx') => void }) {
  const text = [result.topic, ...result.conclusions, ...result.discussionPoints.map((item) => `${item.title}\n${item.content}`), ...result.actionItems.map((item) => item.task), result.keywords.join(' · ')].join('\n');
  return <RecordingResultDialog title="总结报告" onClose={onClose}><section className="recording-summary-report"><h3>主题</h3><p>{result.topic}</p><h3>核心结论</h3><ul>{result.conclusions.map((item) => <li key={item}>{item}</li>)}</ul><h3>讨论要点</h3>{result.discussionPoints.map((item) => <article key={item.title}><h4>{item.title}</h4><p>{item.content}</p></article>)}<h3>待办事项</h3><ul>{result.actionItems.map((item) => <li key={item.task}>□ {item.task}{item.owner && `（负责人：${item.owner}）`}{item.deadline && `（截止：${item.deadline}）`}</li>)}</ul><h3>关键术语</h3><p>{result.keywords.join(' · ')}</p></section><footer><button type="button" onClick={() => void navigator.clipboard.writeText(text)}>复制全文</button><button type="button" onClick={() => onExport('report-txt')}>下载 TXT</button><button type="button" onClick={() => onExport('report-docx')}>下载 Word</button></footer></RecordingResultDialog>;
}
