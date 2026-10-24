const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith('2') || normalized.startsWith('3');
  }

  return false;
}

async function checkExternalLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    return { url: rawUrl, status: 'invalid', reason: 'Invalid URL format.' };
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { url: url.href, status: 'unsafe', reason: 'Only public HTTP(S) links without embedded credentials can be checked.' };
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    return { url: url.href, status: 'unsafe', reason: 'Local network destinations are not checked.' };
  }

  let addresses;
  if (net.isIP(url.hostname)) {
    addresses = [{ address: url.hostname, family: net.isIP(url.hostname) }];
  } else {
    try {
      addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
    } catch (error) {
      return { url: url.href, status: 'broken', reason: 'Hostname could not be resolved.' };
    }
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    return { url: url.href, status: 'unsafe', reason: 'The destination resolves to a non-public network address.' };
  }

  const address = addresses[0];
  const client = url.protocol === 'https:' ? https : http;
  function requestLink(method) {
    return new Promise((resolve) => {
      const request = client.request(url, {
        method,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
        timeout: 4000,
        maxHeaderSize: 8192,
        lookup: (hostname, options, callback) => {
          if (typeof options === 'function') {
            callback = options;
            options = {};
          }
          if (options?.all) return callback(null, addresses);
          const selected = addresses.find((entry) => !options?.family || entry.family === options.family) || address;
          callback(null, selected.address, selected.family);
        },
      }, (response) => {
        if (method === 'GET') response.destroy();
        else response.resume();
        resolve({
          url: url.href,
          status: response.statusCode >= 200 && response.statusCode < 400 ? 'reachable' : 'broken',
          httpStatus: response.statusCode,
          reason: response.statusCode >= 200 && response.statusCode < 400 ? 'Link responded successfully.' : 'Link returned an unsuccessful HTTP status.',
        });
      });

      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (error) => resolve({
        url: url.href,
        status: 'broken',
        reason: error.message === 'timeout' ? 'Link check timed out.' : 'Link could not be reached.',
      }));
      request.end();
    });
  }

  const headResult = await requestLink('HEAD');
  if ([405, 501].includes(headResult.httpStatus)) return requestLink('GET');
  return headResult;
}

module.exports = { checkExternalLink };
