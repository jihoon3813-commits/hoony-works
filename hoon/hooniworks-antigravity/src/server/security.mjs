import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

export function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

// Verify workspace membership and role
const ROLE_WEIGHT = { viewer: 1, editor: 2, owner: 3 };

export function requireWorkspaceAccess(db, userId, workspaceId, minRole = 'viewer') {
  if (!userId) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHORIZED');
  if (!workspaceId) throw new HttpError(400, 'workspaceId가 필요합니다.', 'MISSING_WORKSPACE_ID');
  const ws = db.workspaces.find(w => w.id === workspaceId);
  if (!ws) throw new HttpError(404, '해당 상품 워크스페이스를 찾을 수 없습니다.', 'WORKSPACE_NOT_FOUND');
  const membership = db.memberships.find(m => m.workspaceId === workspaceId && m.userId === userId);
  if (!membership || (ROLE_WEIGHT[membership.role] || 0) < (ROLE_WEIGHT[minRole] || 1)) {
    db.logAudit(workspaceId, userId, 'ACCESS_DENIED', workspaceId, { requiredRole: minRole });
    throw new HttpError(403, '이 상품 워크스페이스에 대한 접근 권한이 없습니다.', 'FORBIDDEN_WORKSPACE');
  }
  return { workspace: ws, membership };
}

// Ensure target record belongs to the exact workspaceId in the URL
export function assertEntityWorkspace(db, userId, entity, expectedWorkspaceId, entityLabel = '레코드') {
  if (!entity) {
    throw new HttpError(404, `${entityLabel}를 찾을 수 없습니다.`, 'ENTITY_NOT_FOUND');
  }
  if (entity.workspaceId !== expectedWorkspaceId) {
    db.logAudit(expectedWorkspaceId, userId, 'CROSS_WORKSPACE_REJECTED', entity.id || 'unknown', {
      entityLabel,
      actualWorkspaceId: entity.workspaceId,
      attemptedWorkspaceId: expectedWorkspaceId
    });
    throw new HttpError(403, `다른 상품 워크스페이스의 ${entityLabel}에는 접근할 수 없습니다.`, 'CROSS_WORKSPACE_FORBIDDEN');
  }
  return entity;
}

// Inspect actual image bytes (PNG, JPEG, WebP) and extract dimensions; reject HTML/SVG/scripts/oversize
export function validateImageBytes(buffer, maxBytes = 12 * 1024 * 1024, maxPixels = 25_000_000) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw new HttpError(400, '유효한 이미지 파일 바이트가 아닙니다.', 'INVALID_FILE_BYTES');
  }
  if (buffer.length > maxBytes) {
    throw new HttpError(413, '파일 용량은 12MB 이하여야 합니다.', 'FILE_TOO_LARGE');
  }
  // Reject HTML / SVG / script tags disguised as images
  const headText = buffer.subarray(0, Math.min(512, buffer.length)).toString('utf8').toLowerCase();
  if (headText.includes('<svg') || headText.includes('<html') || headText.includes('<script') || headText.includes('<!doctype')) {
    throw new HttpError(400, '보안 정책상 SVG/HTML/스크립트 파일은 업로드할 수 없습니다.', 'DISALLOWED_CONTENT');
  }

  let mimeType = null;
  let width = 0;
  let height = 0;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    mimeType = 'image/png';
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  }
  // JPEG: FF D8 FF
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mimeType = 'image/jpeg';
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buffer.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segLen;
    }
    if (!width || !height) {
      width = 800;
      height = 800;
    }
  }
  // WebP: RIFF....WEBP
  else if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    mimeType = 'image/webp';
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      width = buffer.readUInt16LE(26) & 0x3fff;
      height = buffer.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && buffer.length >= 25) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      width = 1 + (((b1 & 0x3f) << 8) | b0);
      height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    } else if (chunk === 'VP8X' && buffer.length >= 30) {
      width = 1 + buffer.readUIntLE(24, 3);
      height = 1 + buffer.readUIntLE(27, 3);
    } else {
      width = 800;
      height = 800;
    }
  } else {
    throw new HttpError(400, 'PNG, JPG, WebP 형식의 실제 이미지 파일만 허용됩니다.', 'UNSUPPORTED_IMAGE_FORMAT');
  }

  if (width <= 0 || height <= 0 || width * height > maxPixels) {
    throw new HttpError(400, `이미지 해상도가 허용 범위(최대 ${maxPixels.toLocaleString()}픽셀)를 초과했습니다.`, 'IMAGE_DIMENSIONS_INVALID');
  }

  return {
    mimeType,
    width,
    height,
    byteSize: buffer.length,
    sha256: sha256Hex(buffer)
  };
}

// Validate external URLs and block SSRF / internal addresses
export function validateSafeExternalUrl(value, channelId = 'website') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, 'https://로 시작하는 올바른 주소를 입력해 주세요.', 'INVALID_URL');
  }
  if (u.protocol !== 'https:' || u.username || u.password) {
    throw new HttpError(400, '인증 정보가 포함되지 않은 HTTPS 주소만 허용됩니다.', 'INSECURE_URL');
  }
  const host = u.hostname.toLowerCase();
  // Reject localhost, loopback, link-local, private networks
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new HttpError(400, '내부 네트워크 또는 로컬 주소는 참고/채널 URL로 사용할 수 없습니다.', 'SSRF_BLOCKED');
  }
  const allowedHosts = {
    instagram: ['instagram.com'],
    kakao: ['pf.kakao.com'],
    blog: ['blog.naver.com', 'm.blog.naver.com'],
    youtube: ['youtube.com', 'youtu.be']
  };
  if (allowedHosts[channelId] && !allowedHosts[channelId].some(h => host === h || host.endsWith('.' + h))) {
    throw new HttpError(400, `해당 채널(${channelId})의 공식 도메인 주소를 입력해 주세요.`, 'CHANNEL_DOMAIN_MISMATCH');
  }
  return u.href;
}
