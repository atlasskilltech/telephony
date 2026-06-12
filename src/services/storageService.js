'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Storage abstraction supporting AWS S3 with a transparent local-disk
 * fallback. Recordings are keyed as /recordings/YYYY/MM/DD/<file> per spec.
 */
class StorageService {
  constructor() {
    this.driver = config.storage.driver;
    if (this.driver === 's3') this._initS3();
  }

  _initS3() {
    const { region, accessKeyId, secretAccessKey, bucket } = config.storage.aws;
    if (!bucket) {
      throw new Error('STORAGE_DRIVER=s3 requires AWS_S3_BUCKET to be set');
    }

    // Lazy require so the AWS SDK is only loaded when actually using S3.
    const { S3Client } = require('@aws-sdk/client-s3');
    const clientConfig = { region };
    // Only pass static credentials when both are provided. Otherwise leave them
    // out so the SDK's default provider chain (EC2/ECS IAM role, shared config,
    // env vars) can resolve them — passing empty strings breaks that chain.
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    } else {
      logger.info('S3 static credentials not set — using default AWS credential provider chain');
    }
    this.s3 = new S3Client(clientConfig);
    this.bucket = bucket;
  }

  /** Build a date-partitioned recording key. */
  buildRecordingKey(filename, date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `recordings/${y}/${m}/${d}/${filename}`;
  }

  async putObject(key, body, contentType = 'application/octet-stream') {
    if (this.driver === 's3') {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
      );
      return { driver: 's3', key, url: `s3://${this.bucket}/${key}` };
    }
    // Local fallback.
    const fullPath = path.join(config.storage.localPath, key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, body);
    return { driver: 'local', key, url: fullPath };
  }

  /**
   * Readable stream for an object. Pass `{ start, end }` (inclusive byte
   * offsets) to fetch a partial range — used to serve HTTP Range requests so
   * audio players can seek without downloading the whole file.
   */
  async getObjectStream(key, range = null) {
    const hasRange = range && Number.isFinite(range.start) && Number.isFinite(range.end);
    if (this.driver === 's3') {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const params = { Bucket: this.bucket, Key: key };
      if (hasRange) params.Range = `bytes=${range.start}-${range.end}`;
      const res = await this.s3.send(new GetObjectCommand(params));
      return res.Body;
    }
    const opts = hasRange ? { start: range.start, end: range.end } : undefined;
    return fs.createReadStream(path.join(config.storage.localPath, key), opts);
  }

  async getObjectBuffer(key) {
    const stream = await this.getObjectStream(key);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  /** Time-limited download URL (presigned for S3, app route for local). */
  async getSignedUrl(key, expiresIn = 900) {
    if (this.driver === 's3') {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn,
      });
    }
    return `/api/v1/calls/recordings/stream?key=${encodeURIComponent(key)}`;
  }

  async deleteObject(key) {
    if (this.driver === 's3') {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return;
    }
    await fs.promises.unlink(path.join(config.storage.localPath, key)).catch(() => {});
  }
}

module.exports = new StorageService();
