import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import sharp from 'sharp';
import {
  decryptMessageBytes,
  encryptMessageBytes,
} from '../database/message-encryption';
import type { UploadMessageDto } from './messages.dto';

const MAX_BYTES = 10 * 1024 * 1024;
function invalid(code: string, status = 400): never {
  throw new HttpException({ code, message: code }, status);
}

@Injectable()
export class ChatFilesService {
  private readonly root = resolve(process.env.CHAT_FILES_DIR ?? 'storage/chat');
  private active = 0;

  path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) invalid('ATTACHMENT_NOT_FOUND', 404);
    return resolve(this.root, key);
  }

  remove(key: string) {
    return rm(this.path(key), { force: true });
  }

  async copy(key: string) {
    return this.saveBuffer(await this.readBuffer(key));
  }

  async saveBuffer(bytes: Buffer) {
    const id = randomUUID();
    const path = this.path(id);
    const temporary = `${path}.tmp`;
    const stored = encryptMessageBytes(bytes);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, stored, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      return id;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async receive(request: Request, input: UploadMessageDto) {
    if (request.headers['content-type'] !== 'application/octet-stream')
      invalid('INVALID_CONTENT_TYPE', 415);
    if (Number(request.headers['content-length'] ?? 0) > MAX_BYTES)
      invalid('FILE_TOO_LARGE', 413);
    if (this.active >= 2) invalid('UPLOAD_BUSY', 503);
    this.active++;
    const id = randomUUID();
    const path = this.path(id);
    const temporary = `${path}.tmp`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    let size = 0;
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const chunks: Buffer[] = [];
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          callback(
            size > MAX_BYTES
              ? new HttpException(
                  { code: 'FILE_TOO_LARGE', message: 'File exceeds 10 MB' },
                  413,
                )
              : null,
            chunk,
          );
        },
      });
      const collector = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });
      await pipeline(request, limit, collector, { signal: abort.signal });
      if (!size) invalid('EMPTY_FILE');
      let bytes = Buffer.concat(chunks);
      let mimeType = 'application/octet-stream';
      let fileName = input.fileName;
      if (input.type === 'image') {
        try {
          // Buffer IO works with both the native and WebAssembly image runtime.
          const image = sharp(bytes, {
            limitInputPixels: 16000000,
            animated: false,
          });
          const metadata = await image.metadata();
          if (
            !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
            (metadata.pages ?? 1) > 1
          )
            invalid('INVALID_IMAGE');
          bytes = await image
            .rotate()
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
          mimeType = 'image/webp';
          fileName = `${input.fileName.replace(/\.[^.]*$/, '').slice(0, 250)}.webp`;
        } catch {
          invalid('INVALID_IMAGE');
        }
      } else if (input.type === 'voice') {
        // Browser MediaRecorder containers; never trust a supplied MIME alone.
        if (
          bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
          bytes.subarray(0, 4096).includes(Buffer.from('webm')) &&
          input.mimeType?.startsWith('audio/webm')
        )
          mimeType = 'audio/webm';
        else if (
          bytes.subarray(0, 4).toString() === 'OggS' &&
          bytes.subarray(0, 4096).includes(Buffer.from('OpusHead')) &&
          input.mimeType?.startsWith('audio/ogg')
        )
          mimeType = 'audio/ogg';
        else if (
          bytes.subarray(4, 8).toString() === 'ftyp' &&
          input.mimeType?.startsWith('audio/mp4')
        )
          mimeType = 'audio/mp4';
        else invalid('INVALID_AUDIO');
      }
      size = bytes.length;
      if (size > MAX_BYTES) invalid('FILE_TOO_LARGE', 413);
      // Compare the plaintext bytes and metadata for retries of the same message,
      // while writing only authenticated ciphertext to disk.
      const stored = encryptMessageBytes(bytes);
      await writeFile(temporary, stored, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      return {
        id,
        objectKey: id,
        fileName,
        mimeType,
        size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        type: input.type,
      };
    } catch (error) {
      await Promise.all([
        rm(temporary, { force: true }),
        rm(path, { force: true }),
      ]);
      if (error instanceof HttpException) throw error;
      if (abort.signal.aborted) invalid('UPLOAD_TIMEOUT', 408);
      throw error;
    } finally {
      clearTimeout(timer);
      this.active--;
    }
  }

  async readBuffer(key: string): Promise<Buffer> {
    let raw: Buffer;
    try {
      raw = await readFile(this.path(key));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        invalid('ATTACHMENT_NOT_FOUND', 404);
      throw error;
    }
    return decryptMessageBytes(raw);
  }

  async stream(key: string) {
    return Readable.from(await this.readBuffer(key));
  }
}
