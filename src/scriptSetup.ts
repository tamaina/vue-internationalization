export function injectScriptSetup(code: string, injection: string): string {
	const setupOpen = findScriptOpenTag(code, tag => /\bsetup(?:\s|=|>|$)/.test(tag));

	if (setupOpen) {
		const insertAt = setupOpen.index + setupOpen.tag.length;
		return `${code.slice(0, insertAt)}${injection}${code.slice(insertAt)}`;
	}

	const scriptOpen = getScriptOpenTag(code);
	const langAttribute = !scriptOpen || isTypeScriptScript(scriptOpen) ? ' lang="ts"' : '';
	return `${code}\n<script setup${langAttribute}>${injection}</script>\n`;
}

export function getScriptSetupOpenTag(code: string): string | undefined {
	return findScriptOpenTag(code, tag => /\bsetup(?:\s|=|>|$)/.test(tag))?.tag;
}

export function getScriptOpenTag(code: string): string | undefined {
	return findScriptOpenTag(code, tag => !/\bsetup(?:\s|=|>|$)/.test(tag))?.tag;
}

function isTypeScriptScript(scriptOpenTag: string): boolean {
	return /\blang\s*=\s*["']tsx?["']/.test(scriptOpenTag);
}

function findScriptOpenTag(code: string, predicate: (tag: string) => boolean): { tag: string; index: number } | undefined {
	const scriptStartPattern = /<script\b/g;
	let match: RegExpExecArray | null;

	while ((match = scriptStartPattern.exec(code)) != null) {
		const tagEnd = findOpenTagEnd(code, match.index);
		if (tagEnd == null) {
			continue;
		}

		const tag = code.slice(match.index, tagEnd + 1);
		if (predicate(tag)) {
			return {
				tag,
				index: match.index,
			};
		}

		scriptStartPattern.lastIndex = tagEnd + 1;
	}

	return undefined;
}

function findOpenTagEnd(code: string, start: number): number | undefined {
	let quote: '"' | '\'' | undefined;

	for (let index = start; index < code.length; index++) {
		const char = code[index];
		if (quote) {
			if (char === quote) {
				quote = undefined;
			}
			continue;
		}

		if (char === '"' || char === '\'') {
			quote = char;
			continue;
		}

		if (char === '>') {
			return index;
		}
	}

	return undefined;
}
