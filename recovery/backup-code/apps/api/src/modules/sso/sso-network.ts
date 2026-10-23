import { Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { request } from 'https';
import type { ClientRequest } from 'http';
import { isIP } from 'net';
import type { CustomFetch } from 'openid-client';
import { SsoDenied } from './sso.policy';

export function approvedHttps(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    url.hostname.endsWith('.')
  )
    throw new SsoDenied();
  return url;
}
/** IPv4 public unicast only. IPv6-only IdPs need a separately reviewed network policy. */
export function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return (
    a !== undefined &&
    b !== undefined &&
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}
@Injectable()
export class SsoNetwork {
  forEndpoints(endpoints: string[]): CustomFetch {
    const approved = new Set(
      endpoints.map((value) => approvedHttps(value).href),
    );
    return async (input, options) => {
      const url = approvedHttps(String(input));
      if (!approved.has(url.href)) throw new SsoDenied();
      const method = options?.method ?? 'GET';
      if (method !== 'GET' && method !== 'POST') throw new SsoDenied();
      // Resolve once, validate all returned A records, and pin the TLS connection.
      // The TLS SNI and certificate hostname remain the administratively approved host.
      return new Promise<Response>((resolve, reject) => {
        let active: ClientRequest | undefined;
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          active?.destroy(new SsoDenied());
          reject(new SsoDenied());
        }, 5000);
        void lookup(url.hostname, { all: true, family: 4 })
          .then((addresses) => {
            if (timedOut) return;
            if (
              !addresses.length ||
              addresses.some((a) => !publicAddress(a.address))
            )
              throw new SsoDenied();
            const headers = Object.fromEntries(
              new Headers(options?.headers).entries(),
            );
            const body =
              options?.body == null ? undefined : String(options.body);
            if (body && Buffer.byteLength(body) > 16384) throw new SsoDenied();
            const req = request(
              url,
              {
                method,
                headers,
                agent: false,
                servername: url.hostname,
                family: 4,
                lookup: (_hostname, _options, callback) =>
                  callback(null, addresses[0]!.address, 4),
              },
              (response) => {
                const chunks: Buffer[] = [];
                let size = 0;
                if (
                  !response.statusCode ||
                  response.statusCode >= 300 ||
                  response.headers['content-encoding']
                ) {
                  response.destroy();
                  req.destroy();
                  clearTimeout(timer);
                  reject(new SsoDenied());
                  return;
                }
                response.on('data', (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 1048576) {
                    response.destroy(new SsoDenied());
                    req.destroy();
                    return;
                  }
                  chunks.push(chunk);
                });
                response.on('error', () => {
                  clearTimeout(timer);
                  reject(new SsoDenied());
                });
                response.on('end', () => {
                  clearTimeout(timer);
                  resolve(
                    new Response(Buffer.concat(chunks), {
                      status: response.statusCode,
                      headers: {
                        'content-type': String(
                          response.headers['content-type'] ?? '',
                        ),
                      },
                    }),
                  );
                });
              },
            );
            active = req;
            req.setTimeout(5000, () => req.destroy(new SsoDenied()));
            const abort = () => req.destroy(new SsoDenied());
            options?.signal?.addEventListener('abort', abort, { once: true });
            req.on('close', () =>
              options?.signal?.removeEventListener('abort', abort),
            );
            req.on('error', () => {
              clearTimeout(timer);
              reject(new SsoDenied());
            });
            if (options?.signal?.aborted) abort();
            else req.end(body);
          })
          .catch(() => {
            clearTimeout(timer);
            reject(new SsoDenied());
          });
      });
    };
  }
}
