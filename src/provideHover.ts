import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as axios from 'axios';
import * as babelParser from '@babel/parser';

/** 缓存信息的文件名称 */
const CACHE_FILE = `${__dirname}/packageInfoCacheFile.json`;

const isRelativePath = (path: string) => {
  const relativePathRegex = /^(?!\/|\\|[a-zA-Z]:).+/;
  return relativePathRegex.test(path);
};

/** 获取鼠标所在位置的单词 */
const getCursorWord = (line: string, position: vscode.Position) => {
	let char = null;
	for (let index = 0; index < line.length; index++) {
		const element = line[index];
		const tag = element === "'" || element === '"' || element === '`';
		if (tag && index > position.character) {
			break;
		}
		if (tag && index <= position.character) {
			char = '';
			continue;
		}
		if (char === null) {
			continue;
		}
		char += element;
	}
	if (char === null) return "";
	return char.replace(/^\s+|\s+$/g, "");
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
	},
	publisher: {
		email: string;
		username: string;
	};
	version: string;
}

/** 初始化缓存文件 */
const genCacheFile = () => {
	if (!fs.existsSync(CACHE_FILE)) {
		fs.writeFile(CACHE_FILE, JSON.stringify({}), {
			encoding: 'utf-8'
		}, () => {
			console.log('文件写入成功');
		});
	}
};

/** 缓存信息，避免每次都加载 */
let packageInfoCaches: Record<string, NpmInfoProps> | null = null;

/**
 * 查询 npm 接口获取包信息，并写入缓存
 * @param packageName 
 */
const getPackageInfo = async (packageName: string) => {
	/** 读取缓存文件 */
	if (!packageInfoCaches) {
		packageInfoCaches = eval('require(CACHE_FILE)') as Record<string, NpmInfoProps>;
	}

	const getData = async () => {
		if (!packageInfoCaches) return;
		const response = await axios.default((`https://proxy.freeless.cn/api/npm-search?name=${packageName}`));
		if (!response?.data?.length) return;
		if (packageInfoCaches[packageName]?.version === response.data[0]?.version) return;
		packageInfoCaches[packageName] = response.data[0];
		if (Object.keys(packageInfoCaches).length > 1000) {
			const first = Object.keys(packageInfoCaches)[0];
			delete packageInfoCaches[first];
		}
		fs.writeFile(CACHE_FILE, JSON.stringify(packageInfoCaches, null, 2), {
			'encoding': 'utf-8'
		}, () => {
			console.log(`${packageName} 写入缓存`);
		});
		return packageInfoCaches[packageName];
	};

	const dataPromise = getData();
	/** 使用缓存数据 */
	if (packageInfoCaches[packageName]) {
		console.log(`${packageName} 缓存生效`);
		return packageInfoCaches[packageName];
	}
	const info = await dataPromise.catch(err => {
		console.log(`${packageName}-err:`, err);
	});
	return info;
};

/** 添加 hover 内容 */
const getHoverContent = async (packageName: string) => {
	const info = await getPackageInfo(packageName);
	if (!info) return;
	const { name, description, links, author } = info;
	const { bugs, homepage, repository, npm } = links;

	if (name !== packageName) return;
	const github1s = repository?.replace('github.com', 'github1s.com');
	const stackoverflow = `https://stackoverflow.com/search?q=${name}`;
	let content = `### 快捷链接\n`;
	if (description) {
		content += `${name}: ${description}\n\n`;
	}
	if (author && author.name) {
		const { name } = author;
		content += `author: ${name}\n\n`;
	}
	if (npm) {
		content += `[npm](${npm}) `;
	}
	if (bugs) {
		content += `| [issues](${bugs}) `;
	}
	if (github1s) {
		content += `| [github1s](${github1s}) `;
	}
	if (homepage) {
		content += `| [homepage](${homepage}) `;
	}
	if (repository) {
		content += `| [repository](${repository}) `;
	}
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
const jsonProvideHover = async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const { fileName } = document;
	const isPackageJson = /\/package\.json$/.test(fileName);
	if (!isPackageJson) return;
	const line = document.lineAt(position.line).text;
	if (!line.includes(":")) return;
	const newLine = line.endsWith(",") ? line.replace(",", ""): line;
	const [packageName, packageVersion] = newLine.split(":");
	const text = document.getText();
	const jsonData = JSON.parse(text);
	const deps = {
		...jsonData["dependencies"],
		...jsonData["devDependencies"],
		...jsonData["resolutions"],
		...jsonData["peerDependencies"],
	};
	const name = packageName.replace(/^\s+|\s+$/g, "").slice(1, -1);
	const version = packageVersion.replace(/^\s+|\s+$/g, "").slice(1, -1);
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
const scriptProvideHover = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const line = document.lineAt(position.line).text;
	const cmd = line.includes('require');
	const esm = line.includes('import');
	if (!cmd && !esm) return;
	const packageName = getCursorWord(line, position);
	if (!packageName) return;
	if (
		packageName.startsWith("/") ||
		packageName.startsWith("./") ||
		packageName.startsWith("../")
	) return;
	return getHoverContent(packageName);
};

const provideHover = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const { languageId } = document;
	if (languageId === 'json') {
		return jsonProvideHover(document, position, token);
	}
	if (
		languageId?.includes('typescript') ||
		languageId?.includes('javascript')
	) {
		return scriptProvideHover(document, position, token);
	}
	return undefined;
};


/** 注册鼠标悬停提示 */
export default (context: vscode.ExtensionContext) => {
	genCacheFile();
	context.subscriptions.push(vscode.languages.registerHoverProvider('*', {
		provideHover,
	}));
};
