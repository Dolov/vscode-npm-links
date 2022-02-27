import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as axios from 'axios'
import * as babelParser from '@babel/parser'

/** 缓存信息的文件名称 */
const CACHE_FILE = `${__dirname}/packageInfoCacheFile.json`

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

/** 生成缓存文件 */
const genCacheFile = () => {
	if (!fs.existsSync(CACHE_FILE)) {
		fs.writeFile(CACHE_FILE, JSON.stringify({}), {
			encoding: 'utf-8'
		}, () => {
			console.log('文件写入成功');
		})
	}
}

/** 缓存信息，避免每次都加载 */
let packageInfoCaches: Record<string, NpmInfoProps> | null = null

/**
 * 查询 npm 接口获取包信息，并写入缓存
 * @param packageName 
 */
const getPackageInfo = async (packageName: string) => {
	/** 读取缓存文件 */
	if (!packageInfoCaches) {
		packageInfoCaches = eval('require(CACHE_FILE)') as Record<string, NpmInfoProps>
	}
	/** 使用缓存数据 */
	if (packageInfoCaches[packageName]) {
		return packageInfoCaches[packageName]
	}
	/** 无缓存数据则请求 */
	const response = await axios.default((`https://www.npmjs.com/search/suggestions?q=${packageName}`))
	if (Array.isArray(response.data) && response.data.length > 0) {
		packageInfoCaches[packageName] = response.data[0]
		/** 写入缓存文件 */
		if (Object.keys(packageInfoCaches).length <= 1000) {
			fs.writeFile(CACHE_FILE, JSON.stringify({
				...packageInfoCaches,
				/** 写入时间戳，计算失效日期 */
				timestamp: new Date().getTime()
			}, null, 2), {
				'encoding': 'utf-8'
			}, () => {
			})
		}
		return packageInfoCaches[packageName]
	}
	return null
}

/** 添加 hover 内容 */
const getHoverContent = async (packageName: string) => {
	// @ts-ignore
	const pName = packageName.replaceAll(`"`, '')
	const info = await getPackageInfo(pName)
	if (!info) return
	const { name, description, links, author } = info
	const { bugs, homepage, repository, npm } = links

	if (name !== pName) return
	const github1s = repository?.replace('github.com', 'github1s.com')
	const stackoverflow = `https://stackoverflow.com/search?q=${name}`
	let content = `### 快捷链接\n`
	if (description) {
		content += `${name}: ${description}\n\n`
	}
	if (author && author.name) {
		const { name } = author
		content += `author: ${name}\n\n`
	}
	if (npm) {
		content += `[npm](${npm}) `
	}
	if (bugs) {
		content += `| [issues](${bugs}) `
	}
	if (github1s) {
		content += `| [github1s](${github1s}) `
	}
	if (homepage) {
		content += `| [homepage](${homepage}) `
	}
	if (repository) {
		content += `| [repository](${repository}) `
	}
	content += `| [stackoverflow](${stackoverflow}) `
	return new vscode.Hover(content);
}

/**
 * json 文件 hover 逻辑
 * @param document 
 * @param position 
 * @param token 
 * @returns 
 */
const jsonProvideHover = async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const { fileName, getText, getWordRangeAtPosition } = document
	const hoverWord = getText(getWordRangeAtPosition(position));
	const isPackageJson = /\/package\.json$/.test(fileName)
	if (!isPackageJson) return
	const json = document.getText();
	const inDeps = new RegExp(`"(dependencies|devDependencies|resolutions|peerDependencies)":\\s*?\\{[\\s\\S]*?${hoverWord.replace(/\//g, '\\/')}[\\s\\S]*?\\}`, 'gm').test(json)
	if (!inDeps) return
	return getHoverContent(hoverWord)
}

/**
 * 脚本类文件 hover 逻辑
 * @param document 
 * @param position 
 * @param token 
 * @returns 
 */
const scriptProvideHover = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const { fileName, getText, getWordRangeAtPosition } = document
	const hoverWord = getText(getWordRangeAtPosition(position));
	const linesText = getText().split('\n')
	/** 获取含有 import from 的文本，避免直接使用 ast 耗费性能 */
	const importFgs = linesText.filter(item => {
		const fItem = item?.replace(/(^\s*)/g, "")
		return (
			fItem?.startsWith('import ') &&
			fItem?.includes(' from ') &&
			fItem?.includes(hoverWord) &&
			hoverWord !== 'import' &&
			hoverWord !== 'from'
		)
	})
	if (importFgs.length === 0) return
	const { line, character } = position
	const lineText = linesText[line]
	const ast = babelParser.parse(lineText, {
		sourceType: 'module'
	})
	const importDeclarations = ast.program.body.filter((item: any) => item.type === "ImportDeclaration")
	const target = importDeclarations.find((item: any) => {
		const { loc, source } = item
		const { end: { column: endColumn }, start: { column: startColumn } } = loc
		return source.value?.includes(hoverWord) && startColumn < character && character < endColumn
	})
	if (!target) return
	return getHoverContent(target.source.value)
}

const provideHover = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
	const { languageId } = document
	if (languageId === 'json') {
		return jsonProvideHover(document, position, token)
	}
	if (
		languageId?.includes('typescript') ||
		languageId?.includes('javascript')
	) {
		return scriptProvideHover(document, position, token)
	}
	return undefined
}


/** 注册鼠标悬停提示 */
export default (context: vscode.ExtensionContext) => {
	genCacheFile()
	context.subscriptions.push(vscode.languages.registerHoverProvider('*', {
		provideHover,
	}));
};
