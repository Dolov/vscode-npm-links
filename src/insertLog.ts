import * as vscode from "vscode";

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

  // 获取当前行的缩进（空格或Tab），用于后续对齐
  const indentMatch = lineText.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";

  // 获取下一行缩进（如果有内容），否则用当前行缩进
  // 这样可以让插入的日志语句在代码块内部自动对齐
  let nextIndent = indent;
  if (position.line + 1 < document.lineCount) {
    const nextLineText = document.lineAt(position.line + 1).text;
    // 只有下一行有内容时才继承其缩进，否则保持当前行缩进
    if (nextLineText.trim().length > 0) {
      const nextIndentMatch = nextLineText.match(/^(\s*)/);
      nextIndent = nextIndentMatch ? nextIndentMatch[1] : indent;
    }
  }

  // 尝试提取变量名：优先用选中内容，否则用当前行第一个变量名（简单正则匹配）
  let varName = document.getText(selection).trim();
  if (!varName) {
    const match = lineText.match(/([a-zA-Z0-9_$]+)/);
    varName = match ? match[1] : "";
  }
  // 如果没找到变量名，则插入一个空的日志语句
  if (!varName) {
    const logText = `${nextIndent}console.log('');`;
    await editor.edit((editBuilder) => {
      // 日志插入到当前行的下一行
      editBuilder.insert(
        new vscode.Position(position.line + 1, 0),
        logText + "\n"
      );
    });

    // 光标定位到引号之间，方便输入内容
    const newLine = position.line + 1;
    const cursorPosition = new vscode.Position(
      newLine,
      nextIndent.length + "console.log('".length
    );
    editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
    return;
  }

  // 正常插入带变量名的日志语句
  const logText = `${nextIndent}console.log('${varName}:', ${varName});`;
  await editor.edit((editBuilder) => {
    editBuilder.insert(
      new vscode.Position(position.line + 1, 0),
      logText + "\n"
    );
  });

  // 选中第一个变量名（在引号中的变量名），方便修改描述
  const newLine = position.line + 1;
  const varNameStart = nextIndent.length + "console.log('".length;
  const varNameEnd = varNameStart + varName.length;
  const startPos = new vscode.Position(newLine, varNameStart);
  const endPos = new vscode.Position(newLine, varNameEnd);
  editor.selection = new vscode.Selection(startPos, endPos);
};

export default insertLog;
