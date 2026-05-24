import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const generatedDir = resolve('docs/.typedoc-api');
const output = resolve('docs/api.md');

const readGenerated = (name) => readFileSync(resolve(generatedDir, name), 'utf8');
const stripModuleHeader = (source) => source
	.replace(/^\[\*\*vite-vue-internationalization\*\*\]\(README\.md\)\n\n\*\*\*\n\n/mu, '')
	.replace(/^\[vite-vue-internationalization\]\(README\.md\) \/ (.+)\n\n# .+\n\n/mu, '## `$1`\n\n')
	.replace(/\(README\.md\)/gu, '(./api.md)');

const index = stripModuleHeader(readGenerated('index.md'));
const virtual = stripModuleHeader(readGenerated('virtual.md'));

writeFileSync(output, `# API Reference

This page is generated from English JSDoc comments by TypeDoc.

Related guides:

- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)
- [Messages](./messages.md)
- [Message Syntax](./message-syntax.md)
- [Build Strategy](./build-strategy.md)

[[toc]]

${index}

${virtual}
`);

rmSync(generatedDir, { force: true, recursive: true });
