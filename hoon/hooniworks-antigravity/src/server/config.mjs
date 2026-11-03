import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const runtimeBaseDir = isServerless ? path.join(os.tmpdir(), 'hooniworks-runtime') : ROOT_DIR;

export const DATA_DIR = process.env.HOONI_DATA_DIR || path.join(runtimeBaseDir, 'local-data');
export const UPLOADS_DIR = process.env.HOONI_UPLOADS_DIR || path.join(runtimeBaseDir, 'uploads');
export const RENDER_DIR = process.env.HOONI_RENDER_DIR || path.join(runtimeBaseDir, 'render-output');

// Convex Dual Deployment Configuration: Development (311) vs Production (248)
export const CONVEX_DEV_URL = 'https://zealous-ferret-311.convex.cloud';
export const CONVEX_PROD_URL = 'https://bold-labrador-248.convex.cloud';
export const IS_PRODUCTION = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
export const DEFAULT_CONVEX_URL = process.env.CONVEX_URL || (IS_PRODUCTION ? CONVEX_PROD_URL : CONVEX_DEV_URL);

for (const dir of [DATA_DIR, UPLOADS_DIR, RENDER_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Load .env if present on server (never exposed to browser)
const envPath = path.join(ROOT_DIR, '.env');
const serverEnv = { ...process.env };
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in serverEnv)) serverEnv[key] = val;
    }
  }
}

// Secret encryption key management (never logged or sent to client)
const secretKeyFile = path.join(DATA_DIR, '.secret-key');
function getEncryptionKey() {
  if (serverEnv.TOKEN_ENCRYPTION_KEY && serverEnv.TOKEN_ENCRYPTION_KEY.length >= 32) {
    return crypto.createHash('sha256').update(serverEnv.TOKEN_ENCRYPTION_KEY).digest();
  }
  if (fs.existsSync(secretKeyFile)) {
    return Buffer.from(fs.readFileSync(secretKeyFile, 'utf8').trim(), 'hex');
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(secretKeyFile, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

const ENCRYPTION_KEY = getEncryptionKey();

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText) {
  const [ivHex, tagHex, dataHex] = String(cipherText).split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid secret payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function signStatePayload(payloadObj) {
  const data = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', ENCRYPTION_KEY).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyStatePayload(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) throw new Error('유효하지 않은 OAuth state 서명입니다.');
  const expected = crypto.createHmac('sha256', ENCRYPTION_KEY).update(data).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('OAuth state 서명 검증에 실패했습니다.');
  }
  const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
    throw new Error('OAuth 인증 요청 시간이 만료되었습니다.');
  }
  return parsed;
}

export function getApiKey(name) {
  if (name === 'Google' || name === 'GOOGLE_API_KEY') {
    return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || serverEnv.GOOGLE_API_KEY || serverEnv.GEMINI_API_KEY || '';
  }
  if (name === 'OpenAI' || name === 'OPENAI_API_KEY') {
    return process.env.OPENAI_API_KEY || serverEnv.OPENAI_API_KEY || '';
  }
  return process.env[name] || serverEnv[name] || '';
}

export function getProviderConnectionStatus() {
  const openaiKey = getApiKey('OpenAI');
  const googleKey = getApiKey('Google');
  return {
    OpenAI: {
      configured: Boolean(openaiKey),
      mode: openaiKey ? 'live_ready' : 'mock',
      textModel: process.env.TEXT_MODEL || serverEnv.TEXT_MODEL || 'gpt-4o-mini',
      imageModel: process.env.IMAGE_MODEL || serverEnv.IMAGE_MODEL || 'dall-e-3'
    },
    Google: {
      configured: Boolean(googleKey),
      mode: googleKey ? 'live_ready' : 'mock',
      videoModel: process.env.VIDEO_MODEL || serverEnv.VIDEO_MODEL || 'imagen-3.0-generate-002',
      voiceModel: process.env.VOICE_MODEL || serverEnv.VOICE_MODEL || 'gemini-2.0-flash'
    },
    OAuthMeta: {
      configured: Boolean((process.env.OAUTH_META_CLIENT_ID || serverEnv.OAUTH_META_CLIENT_ID) && (process.env.OAUTH_META_CLIENT_SECRET || serverEnv.OAUTH_META_CLIENT_SECRET))
    },
    OAuthGoogle: {
      configured: Boolean((process.env.OAUTH_GOOGLE_CLIENT_ID || serverEnv.OAUTH_GOOGLE_CLIENT_ID) && (process.env.OAUTH_GOOGLE_CLIENT_SECRET || serverEnv.OAUTH_GOOGLE_CLIENT_SECRET))
    }
  };
}
