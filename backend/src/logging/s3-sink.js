// Import the Amazon S3 client lazily so local logging does not initialize it.

function s3ObjectKey(prefix, record) {
  return [prefix, record.startedAt.slice(0, 10), `${record.requestId}.json`]
    .filter(Boolean)
    .join('/');
}

export async function createS3Sink({ bucket, prefix }) {
  const sdk = await import('@aws-sdk/client-s3');
  const client = new sdk.S3Client({});

  return async (record) => {
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: bucket,
        Key: s3ObjectKey(prefix, record),
        Body: JSON.stringify(record, null, 2),
        ContentType: 'application/json',
      }),
    );
  };
}
