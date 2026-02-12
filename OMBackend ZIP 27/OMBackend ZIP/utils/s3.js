
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ quiet: true });
// require('dotenv').config();


const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(buffer, fileName, mimeType) {
  // const safeFileName = fileName.replace(/\s+/g, "_"); // replace spaces000
  let safeFileName = decodeURIComponent(fileName)
    .replace(/\s+/g, "_")     // replace spaces
    .replace(/%20/g, "_")    // replace encoded spaces

    .replace(/[^a-zA-Z0-9._-]/g, "_")   // Replace ANY unsafe char with _
    .replace(/\s+/g, "_")              // Spaces → _
    .replace(/_+/g, "_")               // Collapse multiple _ → single _
    .replace(/^_+|_+$/g, "")           // Trim leading/trailing _
  // .replace(/\.(?=[^.]+$)/, "_");     // Ensure only one dot before extension

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `ManglaCRM/${Date.now()}_${safeFileName}`,
    Body: buffer,
    ContentType: mimeType,
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    const url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
    return { Location: url, mimeType };
  } catch (error) {
    throw error;
  }
}

module.exports = uploadToS3;