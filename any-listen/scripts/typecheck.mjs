// 直接调用 TypeScript 编译器 API 做类型检查（不经过 npx/tsc CLI）。
// 保持 noEmit：只读源码，不产出任何文件。
import path from 'node:path';
import ts from 'typescript';

// 用法：node scripts/typecheck.mjs [tsconfig 路径]
// 允许从仓库外调用：cd /tmp && node <repo>/scripts/typecheck.mjs <repo>/tsconfig.json
const target = process.argv[2] ?? process.cwd();
const configPath = ts.sys.fileExists(target)
  ? target
  : ts.findConfigFile(target, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error('找不到 tsconfig.json');
  process.exit(2);
}
const basePath = path.dirname(configPath);

const read = ts.readConfigFile(configPath, ts.sys.readFile);
if (read.error) {
  console.error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  process.exit(2);
}

const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, basePath);
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length === 0) {
  console.log(`typecheck OK: ${parsed.fileNames.length} 个文件无错误`);
  process.exit(0);
}

for (const diagnostic of diagnostics) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    console.log(`${diagnostic.file.fileName}(${line + 1},${character + 1}): TS${diagnostic.code}: ${message}`);
  } else {
    console.log(`TS${diagnostic.code}: ${message}`);
  }
}
console.log(`\n共 ${diagnostics.length} 个错误`);
process.exit(1);
