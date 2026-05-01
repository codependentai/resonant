import { lookup } from 'dns/promises';
import { isIP } from 'net';
import type { InternalToolDefinition, InternalToolResult } from './internal-registry.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 80_000;
const MAX_BYTES = 2_000_000;
const USER_AGENT = 'ResonantWebFetch/1.0 (+https://github.com/codependent-ai/resonant)';

function ok(text: string, data?: unknown): InternalToolResult {
  return { ok: true, text, data };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:169.254.')
  );
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function validateUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be fetched.');
  }
  if (!parsed.hostname) throw new Error('URL hostname is required.');

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Refusing to fetch localhost or local-network hostnames.');
  }
  return parsed;
}

async function assertPublicTarget(url: URL): Promise<void> {
  const hostname = url.hostname;
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Refusing to fetch private, loopback, or reserved IP addresses.');
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error(`Could not resolve host: ${hostname}`);
  for (const address of addresses) {
    if (isPrivateAddress(address.address)) {
      throw new Error('Refusing to fetch a host that resolves to a private, loopback, or reserved IP address.');
    }
  }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      throw new Error(`Response exceeded ${MAX_BYTES} bytes.`);
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  return buffer.toString('utf-8');
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(text: string, contentType: string): string | null {
  if (!contentType.includes('html')) return null;
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToReadableText(match[1]).slice(0, 200) : null;
}

export async function fetchWebUrl(
  rawUrl: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<InternalToolResult> {
  const url = validateUrl(rawUrl);
  await assertPublicTarget(url);

  const timeoutMs = Math.max(1000, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const maxChars = Math.max(1000, Math.min(opts.maxChars ?? DEFAULT_MAX_CHARS, 200_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html, text/plain, application/json, application/xml;q=0.9, */*;q=0.5',
      },
    });

    const redirect = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && redirect) {
      return {
        ok: false,
        text: `Redirect not followed automatically: ${url.toString()} -> ${new URL(redirect, url).toString()}`,
        error: 'redirect_not_followed',
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.match(/(text|json|xml|html|markdown|javascript|csv)/i)) {
      return {
        ok: false,
        text: `Refusing to read non-text response (${contentType || 'unknown content type'}).`,
        error: 'non_text_response',
      };
    }

    const rawText = await readResponseText(response);
    const title = extractTitle(rawText, contentType);
    const readable = contentType.includes('html') ? htmlToReadableText(rawText) : rawText.trim();
    const slice = readable.slice(0, maxChars);
    const truncated = slice.length < readable.length;
    const header = [
      `URL: ${url.toString()}`,
      `Status: ${response.status} ${response.statusText}`,
      `Content-Type: ${contentType || 'unknown'}`,
      title ? `Title: ${title}` : '',
      truncated ? `Content truncated at ${slice.length}/${readable.length} chars.` : '',
    ].filter(Boolean).join('\n');

    return ok(`${header}\n\n${slice}`, {
      url: url.toString(),
      status: response.status,
      contentType,
      title,
      length: readable.length,
      returnedChars: slice.length,
      truncated,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const WEB_INTERNAL_TOOLS: InternalToolDefinition[] = [
  {
    name: 'web.fetch',
    title: 'Fetch URL',
    description: 'Fetch a public http/https URL and return readable text. Use this when the user gives a web link.',
    permission: 'external',
    timeoutMs: 30000,
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        timeoutMs: { type: 'number' },
        maxChars: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    cliExamples: ['web fetch https://example.com'],
    handler: (args) => fetchWebUrl(requireString(args, 'url'), {
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
    }),
  },
];
