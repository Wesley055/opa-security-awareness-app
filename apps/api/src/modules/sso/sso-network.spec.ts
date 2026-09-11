import { lookup } from 'dns/promises';
import { request } from 'https';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { SsoNetwork } from './sso-network';
jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));
describe('SSO bounded HTTPS transport', () => {
  const url = 'https://idp.example.test/jwks';
  const dns = lookup as jest.Mock;
  const https = request as unknown as jest.Mock;
  let status: number,
    body: Buffer,
    req: EventEmitter & {
      destroy: jest.Mock;
      setTimeout: jest.Mock;
      end: jest.Mock;
    };
  beforeEach(() => {
    jest.clearAllMocks();
    status = 200;
    body = Buffer.from('{"keys":[]}');
    dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    req = Object.assign(new EventEmitter(), {
      destroy: jest.fn(),
      setTimeout: jest.fn(),
      end: jest.fn(),
    });
    req.destroy.mockImplementation((error?: Error) => {
      if (error) req.emit('error', error);
      req.emit('close');
      return req;
    });
    https.mockImplementation((_url, options, callback) => {
      expect(options.servername).toBe('idp.example.test');
      expect(options.agent).toBe(false);
      expect(options.family).toBe(4);
      const selected = jest.fn();
      options.lookup('idp.example.test', {}, selected);
      expect(selected).toHaveBeenCalledWith(null, '8.8.8.8', 4);
      req.end.mockImplementation(() => {
        const response = Object.assign(new PassThrough(), {
          statusCode: status,
          headers: {},
        });
        callback(response);
        response.end(body);
      });
      return req;
    });
  });
  const fetch = () =>
    new SsoNetwork().forEndpoints([url])(url, { method: 'GET', body: null, headers: {}, redirect: 'manual' });
  it('pins the public DNS address while retaining TLS hostname verification', async () => {
    expect(await (await fetch()).json()).toEqual({ keys: [] });
    expect(dns).toHaveBeenCalledWith('idp.example.test', {
      all: true,
      family: 4,
    });
  });
  it('rejects mixed public/private DNS answers before connection', async () => {
    dns.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(fetch()).rejects.toThrow();
    expect(https).not.toHaveBeenCalled();
  });
  it('rejects unapproved paths without DNS resolution', async () => {
    await expect(
      new SsoNetwork().forEndpoints([url])(url + '/evil', { method: 'GET', body: null, headers: {}, redirect: 'manual' }),
    ).rejects.toThrow();
    expect(dns).not.toHaveBeenCalled();
  });
  it('never follows redirects', async () => {
    status = 302;
    await expect(fetch()).rejects.toThrow();
    expect(https).toHaveBeenCalledTimes(1);
  });
  it('bounds downloaded bytes', async () => {
    body = Buffer.alloc(1048577);
    await expect(fetch()).rejects.toThrow();
  });
  it('bounds the entire request including stalled DNS', async () => {
    jest.useFakeTimers();
    try {
      dns.mockImplementation(() => new Promise(() => {}));
      const result = fetch();
      const rejected = expect(result).rejects.toThrow();
      await jest.advanceTimersByTimeAsync(5001);
      await rejected;
      expect(https).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
