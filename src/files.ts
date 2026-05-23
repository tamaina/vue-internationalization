import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', '.vite']);

export type ScanVueFilesOptions = {
	include?: string | string[];
	exclude?: string | string[];
};

export function scanVueFiles(root: string, options: ScanVueFilesOptions = {}): string[] {
	const files: string[] = [];
	const matcher = createMatcher(root, options);

	visit(root, files, matcher);

	return files.sort();
}

export function readTextFile(path: string): string {
	return readFileSync(path, 'utf8');
}

function visit(dir: string, files: string[], matcher: FileMatcher): void {
	for (const entry of readdirSync(dir)) {
		if (DEFAULT_IGNORES.has(entry)) {
			continue;
		}

		const path = join(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			if (!matcher.excludes(path, true)) {
				visit(path, files, matcher);
			}
			continue;
		}

		if (stat.isFile() && extname(path) === '.vue' && matcher.includes(path) && !matcher.excludes(path, false)) {
			files.push(path);
		}
	}
}

type FileMatcher = {
	includes(path: string): boolean;
	excludes(path: string, isDirectory: boolean): boolean;
};

function createMatcher(root: string, options: ScanVueFilesOptions): FileMatcher {
	const normalizedRoot = normalizePath(resolve(root));
	const includePatterns = normalizePatterns(options.include ?? '**/*.vue');
	const excludePatterns = normalizePatterns(options.exclude ?? []);

	return {
		includes(path) {
			const candidates = getPathCandidates(normalizedRoot, path);
			return includePatterns.some((pattern) => candidates.some((candidate) => matchGlob(pattern, candidate)));
		},
		excludes(path, isDirectory) {
			const candidates = getPathCandidates(normalizedRoot, path);
			const directoryCandidates = isDirectory ? candidates.map((candidate) => `${candidate}/`) : candidates;

			return excludePatterns.some((pattern) =>
				directoryCandidates.some((candidate) =>
					matchGlob(pattern, candidate) || (isDirectory && matchGlob(`${pattern}/**`, candidate)),
				),
			);
		},
	};
}

function normalizePatterns(value: string | string[]): string[] {
	return (Array.isArray(value) ? value : [value])
		.map((pattern) => normalizePath(pattern))
		.filter((pattern) => pattern.length > 0);
}

function getPathCandidates(root: string, path: string): string[] {
	const normalizedPath = normalizePath(resolve(path));
	const relativePath = normalizePath(relative(root, normalizedPath));
	const candidates = [relativePath, `/${relativePath}`, normalizedPath];

	if (isAbsolute(path)) {
		candidates.push(normalizePath(path));
	}

	return candidates;
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/');
}

function matchGlob(pattern: string, value: string): boolean {
	return matchGlobSegments(pattern.split('/'), value.split('/'));
}

function matchGlobSegments(pattern: string[], value: string[]): boolean {
	if (pattern.length === 0) {
		return value.length === 0;
	}

	const [current, ...rest] = pattern;

	if (current === '**') {
		return matchGlobSegments(rest, value) || (value.length > 0 && matchGlobSegments(pattern, value.slice(1)));
	}

	if (value.length === 0) {
		return false;
	}

	return matchGlobSegment(current, value[0] as string) && matchGlobSegments(rest, value.slice(1));
}

function matchGlobSegment(pattern: string, value: string): boolean {
	let regexp = '^';

	for (const char of pattern) {
		if (char === '*') {
			regexp += '[^/]*';
			continue;
		}

		if (char === '?') {
			regexp += '[^/]';
			continue;
		}

		regexp += escapeRegExp(char);
	}

	return new RegExp(`${regexp}$`, 'u').test(value);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
