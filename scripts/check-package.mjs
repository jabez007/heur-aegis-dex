import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscPath = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'heur-aegis-package-'));

const run = (command, args, cwd, capture = false) => execFileSync(command, args, {
  cwd,
  encoding: capture ? 'utf8' : undefined,
  stdio: capture ? 'pipe' : 'inherit'
});

try {
  let tarballPath = process.argv[2] ? resolve(process.argv[2]) : null;
  if (!tarballPath) {
    const packDirectory = join(temporaryRoot, 'package');
    await mkdir(packDirectory);
    run('npm', ['pack', '--pack-destination', packDirectory], projectRoot);
    const tarballs = (await readdir(packDirectory)).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`Expected one tarball, found ${tarballs.length}.`);
    tarballPath = join(packDirectory, tarballs[0]);
  }

  const consumerRoot = join(temporaryRoot, 'consumer');
  await mkdir(consumerRoot);
  await writeFile(join(consumerRoot, 'package.json'), JSON.stringify({
    private: true,
    type: 'module'
  }, null, 2));

  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarballPath
  ], consumerRoot);

  const packageRoot = join(consumerRoot, 'node_modules', '@jabez007', 'heur-aegis-dex');
  await Promise.all([
    access(join(packageRoot, 'LICENSE')),
    access(join(packageRoot, 'data', 'POKEAPI-NOTICE.md')),
    access(join(packageRoot, 'lib', 'index.d.ts')),
    access(join(packageRoot, 'lib', 'index.d.mts')),
    access(join(packageRoot, 'lib', 'index.d.cts')),
    access(join(packageRoot, 'lib', 'heur-aegis-dex.css'))
  ]);

  run('node', ['--input-type=module', '--eval', [
    "const api = await import('@jabez007/heur-aegis-dex');",
    "const types = await api.getBaseTypes();",
    "if (!api.HeurAegisDexMain || typeof api.default?.install !== 'function' || types.length !== 18) process.exit(1);"
  ].join(' ')], consumerRoot);
  run('node', ['--eval', [
    "const api = require('@jabez007/heur-aegis-dex');",
    "api.getBaseTypes().then((types) => {",
    "if (!api.HeurAegisDexMain || typeof api.default?.install !== 'function' || types.length !== 18) process.exit(1);",
    "}).catch((error) => { console.error(error); process.exit(1); });"
  ].join(' ')], consumerRoot);

  const fixture = [
    "import HeurAegisDex, { HeurAegisDexMain, getResistantTypes } from '@jabez007/heur-aegis-dex';",
    'void HeurAegisDex.install;',
    'void HeurAegisDexMain;',
    'void getResistantTypes;'
  ].join('\n');
  await Promise.all([
    writeFile(join(consumerRoot, 'bundler.ts'), fixture),
    writeFile(join(consumerRoot, 'nodenext.mts'), fixture),
    writeFile(join(consumerRoot, 'node16.cts'), fixture)
  ]);

  const configs = [
    ['bundler', 'bundler.ts', 'ESNext', 'Bundler', 'index.d.mts'],
    ['nodenext', 'nodenext.mts', 'NodeNext', 'NodeNext', 'index.d.mts'],
    ['node16', 'node16.cts', 'Node16', 'Node16', 'index.d.cts']
  ];
  for (const [name, source, module, moduleResolution, expectedTypes] of configs) {
    const configPath = join(consumerRoot, `tsconfig.${name}.json`);
    await writeFile(configPath, JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module,
        moduleResolution,
        strict: true,
        skipLibCheck: false,
        noEmit: true
      },
      files: [source]
    }, null, 2));
    run(process.execPath, [tscPath, '-p', configPath], consumerRoot);
    const trace = run(process.execPath, [tscPath, '-p', configPath, '--traceResolution'], consumerRoot, true);
    if (!trace.includes(`/lib/${expectedTypes}`)) {
      throw new Error(`${name} resolved the wrong declaration entry; expected ${expectedTypes}.`);
    }
  }

  const installedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  console.log(`HEALTHY: ${installedManifest.name}@${installedManifest.version} package contract verified`);
} finally {
  if (!process.env.KEEP_PACKAGE_TEST_TEMP) {
    await rm(temporaryRoot, { force: true, recursive: true });
  } else {
    console.log(`Package test files retained at ${temporaryRoot}`);
  }
}
