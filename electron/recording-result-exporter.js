const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { writeFile } = require('fs/promises');

function transcriptText(result) {
  return result.segments.map((segment) => `[${formatTimestamp(segment.startMs)}]${segment.speakerId ? ` [${segment.speakerId}]` : ''} ${segment.text}`).join('\n');
}

function translationText(result) {
  return result.segments.map((segment) => {
    const prefix = `[${formatTimestamp(segment.startMs)}]${segment.speakerId ? ` [${segment.speakerId}]` : ''} `;
    return `${prefix}原文：${segment.text}\n${' '.repeat(prefix.length)}译文：${segment.translatedText}`;
  }).join('\n\n');
}

function summaryText(result) {
  const lines = [`主题\n${result.topic}`, '', '核心结论', ...result.conclusions.map((item) => `• ${item}`), '', '讨论要点', ...result.discussionPoints.flatMap((item, index) => [`${index + 1}. ${item.title}`, item.content]), '', '待办事项', ...result.actionItems.map((item) => `□ ${item.task}${item.owner ? `（负责人：${item.owner}）` : ''}${item.deadline ? `（截止：${item.deadline}）` : ''}`), '', '关键术语', result.keywords.join(' · ')];
  return lines.join('\n');
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTimestamp(milliseconds) {
  const value = Math.max(0, Math.floor(Number(milliseconds || 0)));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value % 3600000 / 60000);
  const seconds = Math.floor(value % 60000 / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

async function writeSummaryDocx(filePath, { sourceFileName, createdAt, summary }) {
  const bullet = (value) => new Paragraph({ text: value, bullet: { level: 0 } });
  const document = new Document({ sections: [{ children: [
    new Paragraph({ text: '录音总结报告', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `原音频：${sourceFileName}`, italics: true })] }),
    new Paragraph({ children: [new TextRun({ text: `生成时间：${createdAt}`, italics: true })] }),
    new Paragraph({ text: '主题', heading: HeadingLevel.HEADING_1 }), new Paragraph(summary.topic),
    new Paragraph({ text: '核心结论', heading: HeadingLevel.HEADING_1 }), ...summary.conclusions.map(bullet),
    new Paragraph({ text: '讨论要点', heading: HeadingLevel.HEADING_1 }), ...summary.discussionPoints.flatMap((item) => [new Paragraph({ text: item.title, heading: HeadingLevel.HEADING_2 }), new Paragraph(item.content)]),
    new Paragraph({ text: '待办事项', heading: HeadingLevel.HEADING_1 }), ...summary.actionItems.map((item) => bullet(`${item.task}${item.owner ? `（负责人：${item.owner}）` : ''}${item.deadline ? `（截止：${item.deadline}）` : ''}`)),
    new Paragraph({ text: '关键术语', heading: HeadingLevel.HEADING_1 }), new Paragraph(summary.keywords.join(' · ')),
  ] }] });
  await writeFile(filePath, await Packer.toBuffer(document));
}

module.exports = { formatTime, formatTimestamp, summaryText, transcriptText, translationText, writeSummaryDocx };
