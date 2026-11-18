import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const project = new URL('./', import.meta.url);
export const publicRoot = new URL('public/', project);

function listFiles(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(new URL(entry.name + '/', folder), name + '/') : [name];
  });
}

export function readRelease() {
  const { version } = JSON.parse(readFileSync(new URL('package.json', project), 'utf8'));
  const publicFiles = listFiles(publicRoot);
  const offlineFiles = [...publicFiles.filter((name) => name !== 'sw.js' && !name.endsWith('.txt')), 'flow2-84.official.json', 'release.js'];
  const releaseModule = 'export const VERSION = ' + JSON.stringify(version) + ';\nexport const FILES = ' + JSON.stringify(offlineFiles) + ';\n';
  return { version, publicFiles, releaseModule };
}
export const layoutPath = fileURLToPath(new URL('flow2-84.official.json', project));
export const geometry = JSON.stringify({ layouts: JSON.parse(readFileSync(layoutPath, 'utf8')).layouts });
