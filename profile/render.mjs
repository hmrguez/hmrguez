import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { optimize } from 'svgo';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from './data.mjs';
import { cards, readme } from './cards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const types = { '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ttf':'font/ttf' };

// Let the browser lay out the same card once. Print the type as text and keep
// the source lettering, logos, and chart cells as vector shapes.
async function measureCard(markup) {
  document.getElementById('sheet')?.remove();
  document.body.innerHTML = markup;
  await Promise.all(Array.from(document.images, image => image.decode()));
  const box = element => {
    const {x, y, width, height} = element.getBoundingClientRect();
    return {x, y, width, height};
  };
  document.body.getBoundingClientRect();
  await document.fonts.ready;
  const bounds = box(document.body.firstElementChild);
  const width = Math.ceil(bounds.width), height = Math.ceil(bounds.height);
  const paper = document.querySelector('.paper');
  const inserts = [];
  for (const element of paper.querySelectorAll('img, .map')) {
    const position = box(element);
    if (element.matches('.map')) {
      const cells = element.cloneNode(true);
      cells.querySelectorAll('text,style').forEach(node => node.remove());
      inserts.push({...position, source: cells.outerHTML});
      element.querySelectorAll('rect').forEach(node => node.style.visibility = 'hidden');
    } else {
      const response = await fetch(element.src);
      if (!response.ok) throw new Error('Missing artwork: ' + element.src);
      inserts.push({...position, source: await response.text()});
      element.style.visibility = 'hidden';
    }
  }
  const inset = parseFloat(getComputedStyle(paper).borderTopWidth);
  const texture = getComputedStyle(paper, '::after');
  const grain = texture.content !== 'none';
  const shift = parseFloat(texture.backgroundPositionX) || 0;
  const sheet = document.createElement('style');
  sheet.id = 'sheet';
  sheet.textContent = `@page{size:${width}px ${height}px;margin:0}html,body{width:${width}px;height:${height}px;overflow:hidden}.paper:after{display:none}`;
  document.head.append(sheet);
  return {width, height, paper: box(paper), inserts, grain, inset, shift};
}

export async function renderProfile(data, destination = root) {
  const components = cards(data);
  await mkdir(destination, {recursive:true});
  const stage = await mkdtemp(path.join(destination,'.render-'));
  const files = [];
  let browser;
  try {
    const fingerprints = {};
    const manifest = path.join(destination, 'assets', 'renders.json');
    let previous = {};
    try {
      previous = JSON.parse(await readFile(manifest, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Reuse the approved SVG when its component and inputs are unchanged.
    const shared = createHash('sha256');
    for (const file of ['render.mjs','compact_svg.py','requirements.txt','../package-lock.json','cards.css','art/paper-tile.webp','art/JetBrainsMono-Regular.ttf','art/JetBrainsMono-Medium.ttf']) {
      shared.update(await readFile(path.join(here,file)));
    }
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:2});
    // One local origin for the artwork and fonts, including when rendering offline.
    await page.route('https://cabinet.invalid/**', async route => {
      const requestPath = new URL(route.request().url()).pathname.slice(1);
      if (!requestPath) return route.fulfill({contentType:'text/html',
        body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="cards.css"><style>body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style><body></body>'});
      if (requestPath !== 'cards.css' && !/^art\/[\w.-]+$/.test(requestPath)) return route.abort();
      await route.fulfill({contentType:types[path.extname(requestPath)],body:await readFile(path.join(here,requestPath))});
    });
    await page.goto('https://cabinet.invalid/');
    for (const card of components) {
      for (const mobile of card.mobile ? [false,true] : [false]) {
        const article = `<article class="paper ${card.className}${mobile?' mob':''}">${card.html(mobile)}</article>`;
        const html = card.gutter && !mobile
          ? `<div style="width:max-content;padding-${card.gutter}:3px">${article}</div>`
          : article;
        const stem = card.id + (mobile ? '-mobile' : '');
        const name = stem + '.svg';
        const hash = shared.copy().update(html);
        for (const [,file] of html.matchAll(/src="(art\/[\w.-]+)"/g)) {
          hash.update(await readFile(path.join(here,file)));
        }
        const fingerprint = hash.digest('hex');
        fingerprints[name] = fingerprint;
        if (previous[name] === fingerprint) {
          try {
            await readFile(path.join(destination,'assets',name));
            continue;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        const metadata = await page.evaluate(measureCard, html);
        await writeFile(path.join(stage, stem + '.json'), JSON.stringify(metadata));
        await page.pdf({path:path.join(stage, stem + '.pdf'), preferCSSPageSize:true, printBackground:true});
        files.push(name);
      }
    }
    if (files.length) {
      execFileSync('python3', [path.join(here, 'compact_svg.py'), stage], {stdio:'inherit'});
      for (const name of files) {
        const file = path.join(stage, name);
        const svg = optimize(await readFile(file, 'utf8'), {floatPrecision: 2});
        await writeFile(file, svg.data);
      }
    }
    await writeFile(path.join(stage,'README.md'),readme(components));
    const assets = path.join(destination,'assets');
    await mkdir(assets,{recursive:true});
    for (const name of files) await rename(path.join(stage,name),path.join(assets,name));
    await writeFile(manifest, JSON.stringify(fingerprints,null,2)+'\n');
    console.log('Rendered', files.length, 'of', Object.keys(fingerprints).length, 'images');
    await rename(path.join(stage,'README.md'),path.join(destination,'README.md'));
  } finally {
    await browser?.close();
    await rm(stage,{recursive:true,force:true});
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  await renderProfile(loadData());
}
