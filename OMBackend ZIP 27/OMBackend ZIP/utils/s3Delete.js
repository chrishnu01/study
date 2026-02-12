require("dotenv").config({ quiet: true });
const { S3Client, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const deleteS3File = async (fileUrl) => {
  console.log(fileUrl);
  if (!fileUrl) return;
  const file = fileUrl.fileUrl || fileUrl;
  try {
    // Extract key safely
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;

    const regex = new RegExp(`https://${bucket}\\.s3\\.${region}\\.amazonaws\\.com/(.*)`);
    const match = file.match(regex);
    const key = match ? match[1] : null;

    if (!key) throw new Error("Invalid S3 URL format");

    const params = { Bucket: bucket, Key: key };

    try {
      await s3Client.send(new HeadObjectCommand(params)); // Check existence
    } catch (err) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        console.warn(`⚠️ File not found in S3: ${key}`);
        return; // Skip delete if missing
      } else {
        throw err;
      }
    }

    await s3Client.send(new DeleteObjectCommand(params));
    console.log(`✅ Deleted from S3: ${key}`);
  } catch (error) {
    console.error(`❌ Error deleting ${fileUrl} from S3:`, error.message);
    throw new Error(`Failed to delete from S3: ${error.message}`);
  }
};

module.exports = deleteS3File;




// // utils/s3Delete.js
// const AWS = require('aws-sdk');
// require('dotenv').config({ quiet: true });

// const s3 = new AWS.S3({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   region: process.env.AWS_REGION,
// });

// /**
//  * Deletes a video from S3 given its full URL.
//  * @param {string} fileUrl - The full S3 file URL
//  */
// const deleteS3File = async (fileUrl) => {
//   try {
//     // Extract bucket and key from file URL
//     const bucketName = process.env.AWS_S3_BUCKET_NAME;

//     const url = new URL(fileUrl);
//     const key = decodeURIComponent(url.pathname).slice(1); // Remove leading "/"

//     const params = {
//       Bucket: bucketName,
//       Key: key,
//     };

//     await s3.headObject(params).promise(); // Check if file exists
//     await s3.deleteObject(params).promise(); // Delete the file
//     // console.log(`✅ Deleted from S3: ${key}`);
//   } catch (err) {
//     console.error(`❌ Error deleting file from S3:`, err.message);
//     throw err;
//   }
// };

// module.exports = deleteS3File;
