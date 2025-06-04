import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

/** 缓存信息的文件名称 */
const CACHE_FILE = path.join(__dirname, "packageInfoCacheFile.json");

/** 获取鼠标所在位置的单词 */
const getCursorWord = (line: string, position: vscode.Position): string => {
  // 支持 import ... from 'xxx' 或 require('xxx')
  const importRegex = /from\s+['"]([^'"]+)['"]/;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/;
  let match = importRegex.exec(line) || requireRegex.exec(line);
  if (match) return match[1];
  // 兜底：提取光标处的字符串
  const quoteRegex = /['"]([^'"]+)['"]/g;
  let result: RegExpExecArray | null;
  while ((result = quoteRegex.exec(line))) {
    if (
      position.character >= result.index &&
      position.character <= result.index + result[0].length
    ) {
      return result[1];
    }
  }
  return "";
};

/** npm 包信息 */
export interface NpmInfoProps {
  date: string;
  description: string;
  keywords: string[];
  links: {
    bugs: string;
    homepage: string;
    npm: string;
    repository: string;
  };
  maintainers: {
    email: string;
    username: string;
  }[];
  name: string;
  author: {
    email: string;
    name: string;
  };
  publisher: {
    email: string;
    username: string;
  };
  version: string;
}

/** 初始化缓存文件 */
const genCacheFile = () => {
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, "{}", "utf-8");
  }
};

/** 读取缓存 */
const readCache = (): Record<string, NpmInfoProps> => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const content = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
};

/** 写入缓存 */
const writeCache = (cache: Record<string, NpmInfoProps>) => {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e) {
    console.error("写入缓存失败", e);
  }
};

/** 缓存信息，避免每次都加载 */
let packageInfoCaches: Record<string, NpmInfoProps> | null = null;

/**
 * 查询 npm 接口获取包信息，并写入缓存
 * @param packageName
 */
const getPackageInfo = async (
  packageName: string
): Promise<NpmInfoProps | undefined> => {
  if (!packageInfoCaches) {
    packageInfoCaches = readCache();
  }
  if (packageInfoCaches[packageName]) {
    console.log("🎯 命中缓存: ", packageName);
    return packageInfoCaches[packageName];
  }
  const url1 = `https://proxy.freeless.cn/api/npm-search?name=${packageName}`;
  const url2 = `https://www.npmjs.com/search/suggestions?q=${packageName}`;
  try {
    const res = await Promise.race([axios.get(url1), axios.get(url2)]);
    console.log("res: ", res.config.url);
    // 只处理第一个元素，且只兼容 name 字段即可
    const arr = res.data;
    const info = arr && arr[0] && (arr[0].name ? arr[0] : arr[0].package);
    if (info) {
      packageInfoCaches[packageName] = info;
      if (Object.keys(packageInfoCaches).length > 1000) {
        const first = Object.keys(packageInfoCaches)[0];
        delete packageInfoCaches[first];
      }
      writeCache(packageInfoCaches);
      return info;
    }
  } catch (err) {
    console.error(`${packageName}-err:`, err);
  }
};

/** 添加 hover 内容 */
const getHoverContent = async (packageName: string) => {
  const info = await getPackageInfo(packageName);
  if (!info) return;
  const { name, description, links, author } = info;
  const { bugs, homepage, npm } = links;
  if (name !== packageName) return;
  const repository = links?.repository?.replace(/^(@)?git\+/, "") || "";
  const github1s = repository.replace("github.com", "github1s.com");
  const stackoverflow = `https://stackoverflow.com/search?q=${name}`;
  let content = `### 快捷链接\n`;
  if (description) {
    content += `${name}: ${description}\n\n`;
  }
  if (author && author.name) {
    content += `author: ${author.name}\n\n`;
  }
  if (npm) content += `[npm](${npm}) `;
  if (bugs) content += `| [issues](${bugs}) `;
  if (github1s) content += `| [github1s](${github1s}) `;
  if (homepage) content += `| [homepage](${homepage}) `;
  if (repository) content += `| [repository](${repository}) `;
  content += `| [stackoverflow](${stackoverflow}) `;
  return new vscode.Hover(content);
};

/**
 * package.json 文件 hover 逻辑
 * @param document
 * @param position
 * @param token
 * @returns
 */
const jsonProvideHover = async (
  document: vscode.TextDocument,
  position: vscode.Position
) => {
  const { fileName } = document;
  if (!/\/package\.json$/.test(fileName)) return;
  const line = document.lineAt(position.line).text;
  if (!line.includes(":")) return;
  const newLine = line.endsWith(",") ? line.replace(",", "") : line;
  const [packageName, packageVersion] = newLine.split(":");
  if (!packageName || !packageVersion) return;
  let jsonData: any;
  try {
    jsonData = JSON.parse(document.getText());
  } catch {
    return;
  }
  const deps = {
    ...jsonData["dependencies"],
    ...jsonData["devDependencies"],
    ...jsonData["resolutions"],
    ...jsonData["peerDependencies"],
  };
  const name = packageName.trim().replace(/^['"]|['"]$/g, "");
  const version = packageVersion.trim().replace(/^['"]|['"]$/g, "");
  if (deps[name] !== version) return;
  return getHoverContent(name);
};

/**
 * 脚本类文件 hover 逻辑
 * @param document
 * @param position
 * @param token
 * @returns
 */
const scriptProvideHover = (
  document: vscode.TextDocument,
  position: vscode.Position
) => {
  const line = document.lineAt(position.line).text;
  if (!/require\(|import /.test(line)) return;
  const packageName = getCursorWord(line, position);
  if (!packageName) return;
  if (
    packageName.startsWith("/") ||
    packageName.startsWith("./") ||
    packageName.startsWith("../")
  )
    return;
  return getHoverContent(packageName);
};

const provideHover: vscode.HoverProvider["provideHover"] = (
  document,
  position,
  token
) => {
  const { languageId } = document;
  if (languageId === "json") {
    return jsonProvideHover(document, position);
  }
  if (languageId.includes("typescript") || languageId.includes("javascript")) {
    return scriptProvideHover(document, position);
  }
  return undefined;
};

/** 注册鼠标悬停提示 */
export default (context: vscode.ExtensionContext) => {
  genCacheFile();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("*", { provideHover })
  );
};
