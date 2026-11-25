import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from './data.mjs';
import { cards, readme } from './cards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const types = { '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ttf':'font/ttf' };

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
    // Reuse the exact approved bitmap when its component and inputs are unchanged.
    const shared = createHash('sha256');
    for (const file of ['render.mjs','cards.css','art/grain.png','art/JetBrainsMono-Regular.ttf','art/JetBrainsMono-Medium.ttf']) {
      shared.update(await readFile(path.join(here,file)));
    }
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:2});
    // One local origin for the artwork and fonts, including when rendering offline.
    await page.route('https://cabinet.invalid/**', async route => {
      const requestPath = new URL(route.request().url()).pathname.slice(1);
      if (!requestPath) return route.fulfill({contentType:'text/html',
        body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="cards.css"><body></body>'});
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
        const name = card.id+(mobile?'-mobile':'')+'.png';
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
        await page.evaluate(async markup => {
          document.body.innerHTML=markup;
          await Promise.all(Array.from(document.images, image=>image.decode()));
          document.body.getBoundingClientRect();
          await document.fonts.ready;
        },html);
        await page.locator('body > :only-child').screenshot({path:path.join(stage,name),omitBackground:Boolean(card.gutter && !mobile)});
        files.push(name);
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
