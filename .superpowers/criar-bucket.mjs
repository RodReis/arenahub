/**
 * Cria o bucket do ArenaHub no MinIO local. Descartável — ambiente de dev.
 */
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9010',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'arenahub', secretAccessKey: 'arenahub_dev_minio' },
});

const BUCKET = 'arenahub-biometrics';

try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  console.log(`bucket ${BUCKET} ja existe`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  console.log(`bucket ${BUCKET} criado`);
}
