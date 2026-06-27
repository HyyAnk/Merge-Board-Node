import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OPEN_ASSET_FOLDER_ENDPOINT = '/__mergeboard/open-asset-folder';

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32 * 1024) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function isInsideDirectory(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function openFolder(folderPath) {
  const opener = process.platform === 'win32'
    ? { command: 'explorer.exe', args: [folderPath] }
    : process.platform === 'darwin'
      ? { command: 'open', args: [folderPath] }
      : { command: 'xdg-open', args: [folderPath] };

  const child = spawn(opener.command, opener.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function mergeboardLocalBridge() {
  return {
    name: 'mergeboard-local-bridge',
    configureServer(server) {
      server.middlewares.use(OPEN_ASSET_FOLDER_ENDPOINT, async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed' });
          return;
        }
        if (request.headers['x-mergeboard-local'] !== '1') {
          sendJson(response, 403, { error: 'Missing local request header' });
          return;
        }

        try {
          const { rootPath, projectFolder, assetFile } = await readRequestJson(request);
          if (![rootPath, projectFolder, assetFile].every((value) => typeof value === 'string' && value.trim())) {
            throw new Error('Missing rootPath, projectFolder, or assetFile');
          }
          if (path.isAbsolute(projectFolder) || projectFolder.includes('..') || /[\\/]/.test(projectFolder)) {
            throw new Error('Project folder name is not valid');
          }
          if (path.isAbsolute(assetFile) || assetFile.includes('..') || /[\\/]/.test(assetFile)) {
            throw new Error('Asset file name is not valid');
          }

          const root = path.resolve(rootPath);
          const assetFolder = path.resolve(root, projectFolder, 'assets');
          const targetFile = path.resolve(assetFolder, assetFile);
          if (!isInsideDirectory(root, assetFolder) || !isInsideDirectory(assetFolder, targetFile)) {
            throw new Error('Asset path escapes the configured project folder');
          }
          if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
            throw new Error('Asset file was not found on disk');
          }

          openFolder(assetFolder);
          sendJson(response, 200, { ok: true });
        } catch (error) {
          sendJson(response, 400, { error: error.message || 'Could not open asset folder' });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mergeboardLocalBridge()],
});
