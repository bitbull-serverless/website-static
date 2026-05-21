import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontKeyValueStoreClient, DescribeKeyValueStoreCommand, PutKeyCommand, DeleteKeyCommand, ListKeysCommand } from "@aws-sdk/client-cloudfront-keyvaluestore";
import "@aws-sdk/signature-v4a";

const s3 = new S3Client();
const kvsClient = new CloudFrontKeyValueStoreClient();
const KVS_ARN = process.env.KVS_ARN;
const BUCKET_NAME = process.env.BUCKET_NAME;

export const handler = async (event) => {
    console.log('Event received', JSON.stringify(event));

    const getResult = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: 'credentials.txt' }));
    const content = await getResult.Body.transformToString();

    const newCredentials = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('|');
        if (parts.length !== 3) continue;
        const folder = parts[0].trim();
        const username = parts[1].trim();
        const password = parts[2].trim();
        newCredentials[folder] = Buffer.from(username + ':' + password).toString('base64');
    }

    const describeResult = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: KVS_ARN }));
    let etag = describeResult.ETag;

    const existingKeys = [];
    let nextToken;
    do {
        const listResult = await kvsClient.send(new ListKeysCommand({ KvsARN: KVS_ARN, NextToken: nextToken }));
        for (const item of (listResult.Items || [])) existingKeys.push(item.Key);
        nextToken = listResult.NextToken;
    } while (nextToken);

    for (const key of Object.keys(newCredentials)) {
        const putResult = await kvsClient.send(new PutKeyCommand({ KvsARN: KVS_ARN, Key: key, Value: newCredentials[key], IfMatch: etag }));
        etag = putResult.ETag;
    }

    for (const key of existingKeys) {
        if (!(key in newCredentials)) {
            const delResult = await kvsClient.send(new DeleteKeyCommand({ KvsARN: KVS_ARN, Key: key, IfMatch: etag }));
            etag = delResult.ETag;
        }
    }

    const removed = existingKeys.filter(k => !(k in newCredentials));
    console.log('KVS sync complete', { added: Object.keys(newCredentials), removed });
};
