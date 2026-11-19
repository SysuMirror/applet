import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client as MinioClient } from 'minio';
import { badRequest } from './errors.js';

/**
 * 图标存储：MinIO 优先（对象前缀 ssemarket-mp/icons/），本地 <dataDir>/uploads 作为
 * 二级副本与降级路径。API 始终返回 /media/<file>，前端不感知后端存储实现。
 */
const TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/gif': { ext: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
  'image/webp': { ext: 'webp', magic: null },
};

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function mediaFile(filename) {
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(filename)) return null;
  const ext = filename.split('.').pop();
  const types = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  return { filename, contentType: types[ext] };
}

function validateImage(buffer, contentType) {
  const meta = TYPES[contentType];
  if (!meta) throw badRequest('UNSUPPORTED_IMAGE_TYPE', '仅支持 PNG / JPEG / GIF / WebP 图片');
  if (!buffer.length) throw badRequest('EMPTY_FILE', '文件为空');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('FILE_TOO_LARGE', '图片不能超过 2MB');
  if (meta.magic && !meta.magic.every((byte, i) => buffer[i] === byte)) {
    throw badRequest('INVALID_IMAGE', '图片内容与类型不符');
  }
  if (contentType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') throw badRequest('INVALID_IMAGE', '图片内容与类型不符');
  }
  return meta.ext;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function createStorage(config, log) {
  const minio = config.minio;
  let client = null;
  if (minio.enabled && minio.accessKey && minio.secretKey) {
    client = new MinioClient({
      endPoint: minio.endpoint,
      port: minio.port,
      useSSL: minio.useSSL,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
    try {
      const exists = await client.bucketExists(minio.bucket);
      if (!exists) await client.makeBucket(minio.bucket);
      log?.info('storage.minio_ready', { bucket: minio.bucket, prefix: minio.prefix });
    } catch (err) {
      log?.warn('storage.minio_unavailable', { error: String(err?.message || err) });
      client = null;
    }
  }

  return {
    backend: client ? 'minio' : 'local',

    async saveUpload(buffer, contentType) {
      const ext = validateImage(buffer, contentType);
      const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      const localPath = path.join(config.uploadsDir, filename);
      fs.writeFileSync(localPath, buffer);
      let backend = 'local';
      if (client) {
        try {
          const key = `${minio.prefix}icons/${filename}`;
          await client.putObject(minio.bucket, key, buffer, buffer.length, { 'Content-Type': contentType });
          backend = 'minio';
        } catch (err) {
          log?.warn('storage.upload_failed', { error: String(err?.message || err), filename });
        }
      }
      return {
        url: `/media/${filename}`,
        filename,
        size: buffer.length,
        contentType,
        backend,
      };
    },

    async getMedia(filename) {
      const meta = mediaFile(filename);
      if (!meta) return null;
      if (client) {
        try {
          const stream = await client.getObject(minio.bucket, `${minio.prefix}icons/${filename}`);
          return { contentType: meta.contentType, buffer: await streamToBuffer(stream) };
        } catch (err) {
          if (err?.code !== 'NoSuchKey' && err?.code !== 'NotFound') {
            log?.warn('storage.read_failed', { error: String(err?.message || err), filename });
          }
        }
      }
      const localPath = path.join(config.uploadsDir, filename);
      try {
        return { contentType: meta.contentType, buffer: fs.readFileSync(localPath) };
      } catch {
        return null;
      }
    },
  };
}