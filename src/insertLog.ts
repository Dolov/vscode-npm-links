import * as vscode from "vscode";

// 日志插入适配器接口
interface LogInsertAdapter {
  getLogText(varName: string, indent: string): string;
  getEmptyLogText(indent: string): string;
  getVarName(lineText: string, selectionText: string): string;
  getCursorSelection(
    logLine: string,
    indent: string,
    varName: string
  ): [number, number];
  getEmptyCursorPosition(logLine: string, indent: string): number;
}

// JS/TS 适配器
class JsLogInsertAdapter implements LogInsertAdapter {
  getLogText(varName: string, indent: string): string {
    return `${indent}console.log('${varName}:', ${varName});`;
  }
  getEmptyLogText(indent: string): string {
    return `${indent}console.log('');`;
  }
  getVarName(lineText: string, selectionText: string): string {
    if (selectionText.trim()) return selectionText.trim();
    const match = lineText.match(/([a-zA-Z0-9_$]+)/);
    return match ? match[1] : "";
  }
  getCursorSelection(
    logLine: string,
    indent: string,
    varName: string
  ): [number, number] {
    // 选中引号内变量名
    const start = indent.length + "console.log('".length;
    return [start, start + varName.length];
  }
  getEmptyCursorPosition(logLine: string, indent: string): number {
    return indent.length + "console.log('".length;
  }
}

// Python 适配器
class PythonLogInsertAdapter implements LogInsertAdapter {
  getLogText(varName: string, indent: string): string {
    return `${indent}print(f\"${varName}: {${varName}}\")`;
  }
  getEmptyLogText(indent: string): string {
    return `${indent}print(\"\");`;
  }
  getVarName(lineText: string, selectionText: string): string {
    if (selectionText.trim()) return selectionText.trim();
    const match = lineText.match(/([a-zA-Z_][a-zA-Z0-9_]*)/);
    return match ? match[1] : "";
  }
  getCursorSelection(
    logLine: string,
    indent: string,
    varName: string
  ): [number, number] {
    // 选中 f-string 描述部分
    const prefix = 'print(f"';
    const start = indent.length + prefix.length;
    return [start, start + varName.length];
  }
  getEmptyCursorPosition(logLine: string, indent: string): number {
    return indent.length + 'print("'.length;
  }
}

// 适配器工厂
function getAdapter(languageId: string): LogInsertAdapter {
  if (languageId === "python") return new PythonLogInsertAdapter();
  // 默认 JS/TS
  return new JsLogInsertAdapter();
}

/**
 * 注册插入日志命令
 */
const insertLog = async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor");
    return;
  }
  const document = editor.document;
  const selection = editor.selection;
  const position = selection.active;
  const lineText = document.lineAt(position.line).text;
  const adapter = getAdapter(document.languageId);

  // 获取当前行的缩进（空格或Tab），用于后续对齐
  const indentMatch = lineText.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // 获取下一行缩进（如果有内容），否则用当前行缩进
  let nextIndent = indent;
  if (position.line + 1 < document.lineCount) {
    const nextLineText = document.lineAt(position.line + 1).text;
    if (nextLineText.trim().length > 0) {
      const nextIndentMatch = nextLineText.match(/^(\s*)/);
      nextIndent = nextIndentMatch ? nextIndentMatch[1] : indent;
    }
  }

  // 提取变量名
  const selectionText = document.getText(selection);
  const varName = adapter.getVarName(lineText, selectionText);

  if (!varName) {
    // 插入空日志
    const logText = adapter.getEmptyLogText(nextIndent);
    await editor.edit((editBuilder) => {
      editBuilder.insert(
        new vscode.Position(position.line + 1, 0),
        logText + "\n"
      );
    });
    // 光标定位到引号之间
    const newLine = position.line + 1;
    const cursorPos = adapter.getEmptyCursorPosition(logText, nextIndent);
    const cursorPosition = new vscode.Position(newLine, cursorPos);
    editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
    return;
  }

  // 插入带变量名的日志
  const logText = adapter.getLogText(varName, nextIndent);
  await editor.edit((editBuilder) => {
    editBuilder.insert(
      new vscode.Position(position.line + 1, 0),
      logText + "\n"
    );
  });
  // 选中描述部分
  const newLine = position.line + 1;
  const [selStart, selEnd] = adapter.getCursorSelection(
    logText,
    nextIndent,
    varName
  );
  const startPos = new vscode.Position(newLine, selStart);
  const endPos = new vscode.Position(newLine, selEnd);
  editor.selection = new vscode.Selection(startPos, endPos);
};

export default insertLog;
