#!/usr/bin/env node
// Build pyskit into a single self-executing browser script via esbuild.
//
// Outputs:
//   dist/pyskit.bundle.js       — IIFE, readable, for development & debugging
//   dist/pyskit.bundle.min.js   — IIFE, minified, for production deployment
//
// Size budget is informative only — see SPEC §13.1. Reported, not enforced.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = 'dist';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function buildOne({ outfile, minify }) {
  await build({
    entryPoints: ['src/pyskit.js'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    outfile,
    minify,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const raw = fs.readFileSync(outfile);
  const gz = zlib.gzipSync(raw);
  return { raw: raw.length, gz: gz.length };
}

const dev = await buildOne({ outfile: path.join(outDir, 'pyskit.bundle.js'), minify: false });
console.log(`Built dist/pyskit.bundle.js       (${(dev.raw / 1024).toFixed(1)} KB)`);

const prod = await buildOne({ outfile: path.join(outDir, 'pyskit.bundle.min.js'), minify: true });
console.log(`Built dist/pyskit.bundle.min.js   (${(prod.raw / 1024).toFixed(1)} KB raw, ${(prod.gz / 1024).toFixed(1)} KB gzipped)`);
