#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const requiredScripts = ['ci:syntax', 'test', 'ci:smoke'];
const requiredFiles = [
  'scripts/ci-syntax-check.js',
  'scripts/ci-smoke.js',
  '.github/workflows/ci.yml',
];
const excludedDirs = new Set(['.git', '.github', 'data', 'node_modules']);

function collectJsFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      collectJsFiles(fullPath, out);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(fullPath);
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validatePackageScripts() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const scripts = packageJson.scripts || {};
  const missing = requiredScripts.filter((name) => typeof scripts[name] !== 'string');
  if (missing.length) {
    fail(`Missing npm scripts in package.json: ${missing.join(', ')}`);
  }
}

function validateRequiredFiles() {
  const missing = requiredFiles.filter((relPath) => {
    const fullPath = path.join(projectRoot, relPath);
    return !fs.existsSync(fullPath);
  });

  if (missing.length) {
    fail(`Missing required CI files: ${missing.join(', ')}`);
  }
}

function validateSyntax() {
  const files = collectJsFiles(projectRoot).sort();
  if (files.length === 0) {
    fail('No JavaScript files found to validate.');
  }

  let failed = 0;
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      failed += 1;
      console.error(`\nSyntax check failed: ${path.relative(projectRoot, file)}`);
      if (result.stderr) {
        console.error(result.stderr.trimEnd());
      }
    }
  }

  if (failed > 0) {
    fail(`\nSyntax validation failed for ${failed} file(s).`);
  }

  console.log(`Syntax validation passed for ${files.length} JavaScript file(s).`);
}

validatePackageScripts();
validateRequiredFiles();
validateSyntax();
