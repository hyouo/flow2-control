import { cp, mkdir, writeFile } from 'node:fs/promises';
import { project, publicRoot, readRelease, geometry } from './release.mjs';

const destination = new URL('dist/', project);
const { publicFiles, releaseModule } = readRelease();
await mkdir(destination, { recursive: true });
for (const path of publicFiles) {
  const target = new URL(path, destination);
  await mkdir(new URL('./', target), { recursive: true });
  await cp(new URL(path, publicRoot), target);
}
await writeFile(new URL('flow2-84.official.json', destination), geometry);
await writeFile(new URL('release.js', destination), releaseModule);
await cp(new URL('LICENSE', project), new URL('LICENSE', destination));
console.log('Static site ready in dist/');
