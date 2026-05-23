import { URL } from 'node:url';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const sourceDir = new URL('../.volar-cjs-build/', import.meta.url);
const distDir = new URL('../dist/', import.meta.url);
const files = ['volar', 'localeTypes', 'parse'];

await mkdir(distDir, { recursive: true });

for (const name of files) {
	const source = new URL(`${name}.js`, sourceDir);
	const target = new URL(`${name}.cjs`, distDir);
	const code = await readFile(source, 'utf8');

	await writeFile(target, rewriteRequires(name === 'volar' ? exposeDefaultAsCommonJs(code) : code));
}

await rm(sourceDir, { force: true, recursive: true });

function rewriteRequires(code) {
	return code
		.replaceAll('require("./localeTypes.js")', 'require("./localeTypes.cjs")')
		.replaceAll('require("./parse.js")', 'require("./parse.cjs")');
}

function exposeDefaultAsCommonJs(code) {
	return `${code}\nmodule.exports = exports.default;\nmodule.exports.default = exports.default;\n`;
}
