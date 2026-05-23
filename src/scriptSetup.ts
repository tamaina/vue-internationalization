export function injectScriptSetup(code: string, injection: string): string {
	const setupOpen = code.match(/<script\b(?=[^>]*\bsetup\b)[^>]*>/);

	if (setupOpen?.index != null) {
		const insertAt = setupOpen.index + setupOpen[0].length;
		return `${code.slice(0, insertAt)}${injection}${code.slice(insertAt)}`;
	}

	const scriptOpen = getScriptOpenTag(code);
	const langAttribute = !scriptOpen || isTypeScriptScript(scriptOpen) ? ' lang="ts"' : '';
	return `${code}\n<script setup${langAttribute}>${injection}</script>\n`;
}

export function getScriptSetupOpenTag(code: string): string | undefined {
	return code.match(/<script\b(?=[^>]*\bsetup\b)[^>]*>/)?.[0];
}

export function getScriptOpenTag(code: string): string | undefined {
	return code.match(/<script\b(?![^>]*\bsetup\b)[^>]*>/)?.[0];
}

function isTypeScriptScript(scriptOpenTag: string): boolean {
	return /\blang\s*=\s*["']tsx?["']/.test(scriptOpenTag);
}
