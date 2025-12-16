import { Api, TelegramClient } from "telegram";

import { NewMessage } from "telegram/events/NewMessage.js";

import { StringSession } from "telegram/sessions/index.js";

import * as dotenv from "dotenv";

import { createClient } from "redis";

import fs from "fs";

import path from "path";

import FormData from "form-data";

import fetch from "node-fetch";
import { addImageProcessingJob, getJobStatus } from "./queue-utils.mjs";

dotenv.config();

// Helper function to get file extension from MIME type
function getExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/svg+xml": ".svg",
    "video/mp4": ".mp4",
    "video/mpeg": ".mpeg",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/css": ".css",
    "text/javascript": ".js",
    "application/json": ".json",
    "application/xml": ".xml",
    "application/zip": ".zip",
    "application/x-rar-compressed": ".rar",
    "application/x-7z-compressed": ".7z",
  };

  return mimeToExt[mimeType] || "";
}

// Process images using BullMQ queue
async function processImagesWithQueue(images, options = {}) {
  try {
    const logoPath = path.join(process.cwd(), "images", "28news-logo.png");

    if (!fs.existsSync(logoPath)) {
      console.error("28news logo not found at:", logoPath);
      throw new Error("Logo file not found");
    }

    const jobResult = await addImageProcessingJob({
      images: images.map((img) => ({
        ...img,
        originalname: img.originalname,
        mimetype: img.mimetype,
      })),
      logoPath,
      options: {
        logoOpacity: options.logoOpacity || 80,
        logoSize: options.logoSize || 20,
        padding: options.padding || 80,
        logoPosition: options.logoPosition || "bottom-right",
      },
      generateThumbnail: false, // Signals-forward doesn't need thumbnails
      priority: 2, // Higher priority for signals-forward
      source: "signals-forward",
    });

    console.log(
      `✅ Image processing job ${jobResult.jobId} queued for ${images.length} images`
    );
    return jobResult;
  } catch (error) {
    console.error("Error queuing image processing job:", error);
    throw error;
  }
}

// Process single image using queue and send reply
async function processImageAndReply(client, message, imagePath) {
  try {
    console.log(`Queuing image for processing: ${imagePath}`);

    const originalFormat = path.extname(imagePath).slice(1).toLowerCase();
    const baseFileName = path.basename(imagePath, path.extname(imagePath));

    // Determine output extension
    let outputExtension = path.extname(imagePath) || ".jpg";
    if (message.media?.document?.mimeType) {
      const mimeExtension = getExtensionFromMimeType(
        message.media.document.mimeType
      );
      if (mimeExtension) {
        outputExtension = mimeExtension;
      }
    }

    // Prepare single image for queue
    const imagesToProcess = [
      {
        path: imagePath,
        originalname: `${baseFileName}${outputExtension}`,
        mimetype: message.media?.document?.mimeType || "image/jpeg",
        messageId: message.id,
      },
    ];

    // Queue image for processing
    const jobResult = await processImagesWithQueue(imagesToProcess);

    // Monitor job status and send when complete
    const chatId = message.chatId?.toString() || message.peerId?.toString();
    monitorJobAndSendResult(
      jobResult.jobId,
      chatId,
      message.id,
      baseFileName,
      outputExtension
    );

    // Clean up original file
    setTimeout(() => {
      try {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          console.log(`Cleaned up original file: ${imagePath}`);
        }
      } catch (err) {
        console.warn(`Failed to cleanup original file: ${err.message}`);
      }
    }, 1000);
  } catch (error) {
    console.error("Error queuing image for processing:", error);
  }
}

// Monitor job status and send result when complete
async function monitorJobAndSendResult(
  jobId,
  chatId,
  replyToMessageId,
  baseFileName,
  outputExtension
) {
  const maxAttempts = 600; // 60 seconds max wait
  let attempts = 0;

  const checkStatus = async () => {
    try {
      attempts++;
      const jobStatus = await getJobStatus(jobId);

      if (!jobStatus) {
        console.error(`Job ${jobId} not found`);
        return;
      }

      console.log(
        `Job ${jobId} status: ${jobStatus.status} (${jobStatus.progress}%)`
      );

      if (
        jobStatus.status === "completed" &&
        jobStatus.returnvalue?.processedImages
      ) {
        const processedImages = jobStatus.returnvalue.processedImages;

        for (const img of processedImages) {
          if (img.status === "completed" && img.fullImageUrl) {
            try {
              // Download processed image from server
              const serverUrl =
                process.env.SERVER_URL || "http://localhost:3000";
              const imageUrl = `${serverUrl}${img.fullImageUrl}`;
              const response = await fetch(imageUrl);

              if (response.ok) {
                const imageBuffer = await response.buffer();
                const tempPath = `media_temp/temp_${Date.now()}_${baseFileName}${outputExtension}`;
                fs.writeFileSync(tempPath, imageBuffer);

                // Send processed image
                await sendProcessedImage(
                  chatId,
                  tempPath,
                  replyToMessageId,
                  baseFileName,
                  outputExtension
                );

                // Clean up temp file
                setTimeout(() => {
                  try {
                    if (fs.existsSync(tempPath)) {
                      fs.unlinkSync(tempPath);
                    }
                  } catch (err) {
                    console.warn(`Failed to cleanup temp file: ${err.message}`);
                  }
                }, 5000);
              }
            } catch (error) {
              console.error(
                `Error sending processed image for job ${jobId}:`,
                error
              );
            }
          }
        }
        return; // Job completed
      } else if (jobStatus.status === "failed") {
        console.error(`Job ${jobId} failed:`, jobStatus.failedReason);
        return; // Job failed
      } else if (attempts >= maxAttempts) {
        console.error(`Job ${jobId} timeout after ${maxAttempts} attempts`);
        return; // Timeout
      }

      // Continue monitoring
      setTimeout(checkStatus, 1000);
    } catch (error) {
      console.error(`Error monitoring job ${jobId}:`, error);
    }
  };

  // Start monitoring
  setTimeout(checkStatus, 1000);
}

// Send processed image with retry logic
async function sendProcessedImage(
  chatId,
  imagePath,
  replyToMessageId,
  baseFileName,
  outputExtension
) {
  let success = false;
  let attempts = 0;
  const maxAttempts = 3;
  let lastError = null;

  while (!success && attempts < maxAttempts) {
    attempts++;
    try {
      console.log(
        `Sending processed image (attempt ${attempts}/${maxAttempts})`
      );

      if (attempts === 1) {
        await bot.telegram.sendDocument(
          chatId,
          {
            source: imagePath,
            filename: `28news_${baseFileName}${outputExtension}`,
          },
          {
            reply_to_message_id: replyToMessageId,
          }
        );
      } else if (
        attempts === 2 &&
        [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(
          outputExtension.toLowerCase()
        )
      ) {
        await bot.telegram.sendPhoto(
          chatId,
          { source: imagePath },
          {
            reply_to_message_id: replyToMessageId,
            caption: "📸 Processed with 28News logo",
          }
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await bot.telegram.sendDocument(
          chatId,
          {
            source: imagePath,
            filename: `28news_${baseFileName}${outputExtension}`,
          },
          {
            reply_to_message_id: replyToMessageId,
          }
        );
      }

      success = true;
      console.log(`✅ Successfully sent processed image (attempt ${attempts})`);
    } catch (error) {
      lastError = error;
      console.error(
        `❌ Send attempt ${attempts}/${maxAttempts} failed:`,
        error.message
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }

  if (!success) {
    console.error(
      `❌ All ${maxAttempts} attempts failed. Last error:`,
      lastError
    );
  }
}

// Monitor group job status and send media group when complete
async function monitorGroupJobAndSend(
  jobId,
  chatId,
  replyToMessageId,
  imagesToProcess
) {
  const maxAttempts = 6000; // 60 seconds max wait
  let attempts = 0;

  const checkStatus = async () => {
    try {
      attempts++;
      const jobStatus = await getJobStatus(jobId);

      if (!jobStatus) {
        console.error(`Group job ${jobId} not found`);
        return;
      }

      console.log(
        `Group job ${jobId} status: ${jobStatus.status} (${jobStatus.progress}%)`
      );

      if (
        jobStatus.status === "completed" &&
        jobStatus.returnvalue?.processedImages
      ) {
        const processedImages = jobStatus.returnvalue.processedImages;

        try {
          console.log(
            `Preparing to send ${processedImages.length} processed images as a group`
          );

          // Download all processed images and prepare media group
          const mediaGroup = [];
          const tempFiles = [];

          for (const img of processedImages) {
            if (img.status === "completed" && img.fullImageUrl) {
              try {
                const serverUrl =
                  process.env.SERVER_URL || "http://localhost:3000";
                const imageUrl = `${serverUrl}${img.fullImageUrl}`;
                console.log(`Downloading processed image: ${imageUrl}`);
                const response = await fetch(imageUrl);

                if (response.ok) {
                  const imageBuffer = await response.buffer();
                  const tempPath = `media_temp/group_temp_${Date.now()}_${
                    img.originalName
                  }`;
                  fs.writeFileSync(tempPath, imageBuffer);
                  tempFiles.push(tempPath);

                  mediaGroup.push({
                    type: "document",
                    media: { source: tempPath },
                    filename: `28news_${img.originalName}`,
                  });
                }
              } catch (error) {
                console.error(
                  `Error downloading processed image: ${error.message}`
                );
              }
            }
          }

          if (mediaGroup.length > 0) {
            // Send as media group
            await bot.telegram.sendMediaGroup(chatId, mediaGroup, {
              reply_to_message_id: replyToMessageId,
            });

            console.log(
              `✅ Successfully sent ${mediaGroup.length} images as a group`
            );

            // Clean up temp files
            setTimeout(() => {
              for (const tempFile of tempFiles) {
                try {
                  if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                    console.log(`Cleaned up group temp file: ${tempFile}`);
                  }
                } catch (err) {
                  console.warn(
                    `Failed to cleanup group temp file: ${err.message}`
                  );
                }
              }
            }, 5000);
          }
        } catch (error) {
          console.error(`Error sending group media for job ${jobId}:`, error);
        }
        return; // Job completed
      } else if (jobStatus.status === "failed") {
        console.error(`Group job ${jobId} failed:`, jobStatus.failedReason);
        return; // Job failed
      } else if (attempts >= maxAttempts) {
        console.error(
          `Group job ${jobId} timeout after ${maxAttempts} attempts`
        );
        return; // Timeout
      }

      // Continue monitoring
      setTimeout(checkStatus, 4000);
    } catch (error) {
      console.error(`Error monitoring group job ${jobId}:`, error);
    }
  };

  // Start monitoring
  setTimeout(checkStatus, 1000);
}

// Object để lưu trạng thái và messages của media groups đang xử lý
const processingMediaGroups = new Map(); // key: groupId, value: { messages: [], processing: boolean }

import { Telegraf } from "telegraf";

// Initialize Telegraf bot for replies
const bot = new Telegraf("8286514228:AAFl_vOPvDzFVJXuUrNGK04z2K8Wyf-s04M");

// Khởi tạo Redis client
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      // Tối đa 20 lần thử lại
      if (retries > 20) {
        return new Error("Quá số lần thử kết nối Redis");
      }
      const delay = Math.min(2 ** retries * 1000, 10000);
      return delay;
    },
  },
});

// Handle Redis errors
redis.on("error", (err) => {
  console.error("Redis error:", err);
});

// Handle Redis ready state
redis.on("ready", () => {
  console.log("✓ Redis connected and ready");
});

// Handle Redis reconnecting
redis.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

// Connect to Redis
await redis.connect().catch((err) => {
  console.error("Failed to connect to Redis:", err);
  process.exit(1);
});

// Helper function để lưu message mapping
async function saveMessageMapping(
  fromId,
  originalMsgId,
  destChannelId,
  forwardedMsgId
) {
  const key = `msg_map:${fromId}:${originalMsgId}:${destChannelId}`;
  await redis.set(key, forwardedMsgId);
  // Set TTL 30 ngày
  await redis.expire(key, 30 * 24 * 60 * 60);
}

// Helper function để lấy message mapping
async function getMessageMapping(fromId, originalMsgId, destChannelId) {
  const key = `msg_map:${fromId}:${originalMsgId}:${destChannelId}`;
  return await redis.get(key);
}

// Store files in Redis for potential future use
async function storeFilesInRedis(downloadedFiles, metadata) {
  try {
    // Store files and create download links
    for (let i = 0; i < downloadedFiles.length; i++) {
      const file = downloadedFiles[i];

      if (fs.existsSync(file.filePath)) {
        // Generate unique file ID
        const fileId = `${metadata.groupId}_${file.messageId}_${file.timestamp}`;

        // Store file metadata in Redis
        const fileMetadata = {
          filePath: file.filePath,
          type: file.type,
          caption: file.caption,
          messageId: file.messageId,
          timestamp: file.timestamp,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          originalFileName: path.basename(file.filePath),
          uploadTime: Date.now(),
        };

        // Store in Redis with 24 hour expiry
        await redis.setEx(
          `file:${fileId}`,
          24 * 60 * 60,
          JSON.stringify(fileMetadata)
        );

        console.log(`Stored file metadata in Redis: ${fileId}`);
      }
    }
  } catch (error) {
    console.error("Error storing files in Redis:", error);
  }
}

// Ensure media_temp directory exists
const mediaDir = "./media_temp";
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Function to clean up old media files and Redis entries
async function cleanupOldFiles() {
  try {
    if (!fs.existsSync(mediaDir)) {
      return;
    }

    const files = fs.readdirSync(mediaDir);
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    let deletedCount = 0;
    for (const file of files) {
      const filePath = path.join(mediaDir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime.getTime() < twentyFourHoursAgo) {
        fs.unlinkSync(filePath);
        deletedCount++;
        console.log(`Deleted old file: ${file}`);
      }
    }

    // Also cleanup expired Redis entries (scan for file: keys)
    try {
      const keys = await redis.keys("file:*");
      let expiredRedisCount = 0;

      for (const key of keys) {
        const fileMetadataStr = await redis.get(key);
        if (fileMetadataStr) {
          const fileMetadata = JSON.parse(fileMetadataStr);
          if (
            fileMetadata.uploadTime &&
            fileMetadata.uploadTime < twentyFourHoursAgo
          ) {
            await redis.del(key);
            expiredRedisCount++;
            console.log(`Deleted expired Redis entry: ${key}`);
          }
        }
      }

      if (expiredRedisCount > 0) {
        console.log(
          `Redis cleanup: ${expiredRedisCount} expired entries removed`
        );
      }
    } catch (redisError) {
      console.error("Error during Redis cleanup:", redisError);
    }

    if (deletedCount > 0) {
      console.log(`File cleanup completed: ${deletedCount} files deleted`);
    }
  } catch (error) {
    console.error("Error during file cleanup:", error);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// Run initial cleanup on startup
console.log("Running initial file cleanup...");
cleanupOldFiles();

const REFUNDCASH_GROUPS = {
  "-1002662658720": {
    name: "RefundCash Channel",
    // No destinations - only webhook processing
  },
  "-1002674156935": {
    name: "RefundCash Channel",
    // No destinations - only webhook processing
  },
};

(async () => {
  console.log("Starting Telegram client");
  try {
    const stringSession = new StringSession(process.env.GRAM_SESSION);
    const client = new TelegramClient(
      stringSession,
      Number(process.env.APP_API_ID),
      String(process.env.APP_API_HASH),
      { connectionRetries: 5 }
    );
    await client.connect();

    console.log("Connected to Telegram");

    // Lấy tất cả chat IDs từ các groups và chuyển thành BigInt
    const getAllChatIds = (groups) => Object.keys(groups).map(BigInt);

    let validChats = [...getAllChatIds(REFUNDCASH_GROUPS)];

    validChats = new Set(validChats);
    validChats = Array.from(validChats);

    const filter = new NewMessage({
      chats: validChats,
    });

    client.addEventHandler(async function (event) {
      let fromId = event.chatId.toString();
      let message = event.message;

      if (
        message.fromId &&
        message.fromId.userId &&
        message.fromId.userId.toString() === "8286514228"
      ) {
        return;
      }

      // Log all incoming messages
      console.log(`\n=== NEW MESSAGE RECEIVED ===`);
      console.log(`From Channel ID: ${fromId}`);
      console.log(`Message ID: ${message.id}`);
      console.log(`Message Type: ${message.media?.className || "text"}`);
      console.log(
        `Has Media: ${!!(
          message.media ||
          message.photo ||
          message.document ||
          message.video
        )}`
      );
      console.log(`Has Media Group: ${!!message.groupedId}`);
      if (message.groupedId) {
        console.log(`Group ID: ${message.groupedId.toString()}`);
      }
      console.log(
        `Message Text: ${message.text || message.message || "[No text]"}`
      );
      console.log(`Timestamp: ${new Date().toISOString()}`);
      console.log(`Is RefundCash Channel: ${!!REFUNDCASH_GROUPS[fromId]}`);
      console.log(`==============================\n`);

      // Handle REFUNDCASH_GROUPS messages
      if (REFUNDCASH_GROUPS[fromId]) {
        try {
          const hasMedia =
            message.media || message.photo || message.document || message.video;
          const hasMediaGroup = message.groupedId;

          console.log(
            `Received message from RefundCash channel: ${message.id}`
          );

          if (hasMedia && hasMediaGroup) {
            // Handle media group - store in Redis and process images
            const groupId = message.groupedId.toString();
            const destinationKey = `${groupId}_processing`;

            // Kiểm tra và khởi tạo group data nếu chưa có
            if (!processingMediaGroups.has(destinationKey)) {
              processingMediaGroups.set(destinationKey, {
                messages: [],
                processing: false,
                timer: setTimeout(async () => {
                  // Lấy group data
                  const groupData = processingMediaGroups.get(destinationKey);
                  if (!groupData || groupData.processing) return;

                  // Đánh dấu đang xử lý
                  groupData.processing = true;

                  try {
                    // Download and prepare all media in the group (parallel download)
                    const downloadedFiles = [];

                    // Create download promises for parallel processing
                    const downloadPromises = groupData.messages.map(
                      async (mediaMsg) => {
                        const timestamp = Date.now();
                        const mediaPath = `media_temp/${timestamp}_${mediaMsg.id}`;

                        // Download media file
                        const downloadedPath = await client.downloadMedia(
                          mediaMsg,
                          {
                            outputFile: mediaPath,
                            progressCallback: (progress) => {
                              // Optional: log download progress
                              if (progress.total && progress.downloaded) {
                                const percent = Math.round(
                                  (progress.downloaded / progress.total) * 100
                                );
                                if (percent % 25 === 0) {
                                  // Log every 25%
                                  console.log(
                                    `Download progress for ${mediaMsg.id}: ${percent}%`
                                  );
                                }
                              }
                            },
                          }
                        );

                        // Determine media type - handle photos, videos, and documents
                        let mediaType;
                        let fileName = null;
                        let mimeType = null;
                        let fileSize = null;

                        if (mediaMsg.media?.className === "MessageMediaPhoto") {
                          mediaType = "photo";
                        } else if (
                          mediaMsg.media?.className === "MessageMediaDocument"
                        ) {
                          const document = mediaMsg.media.document;
                          mimeType = document?.mimeType;
                          fileSize = document?.size;

                          // Get original filename if available
                          fileName = document?.attributes?.find(
                            (attr) =>
                              attr.className === "DocumentAttributeFilename"
                          )?.fileName;

                          // Check if document is video or other file type
                          if (mimeType?.startsWith("video/")) {
                            mediaType = "video";
                          } else if (mimeType?.startsWith("image/")) {
                            mediaType = "photo";
                          } else {
                            mediaType = "document";
                          }
                        } else {
                          mediaType = "video"; // fallback for other video types
                        }

                        // Return file data for parallel processing
                        return {
                          type: mediaType,
                          filePath: downloadedPath,
                          caption: mediaMsg.message || "",
                          messageId: mediaMsg.id,
                          timestamp: timestamp,
                          fileName: fileName,
                          mimeType: mimeType,
                          fileSize: fileSize,
                        };
                      }
                    );

                    // Wait for all downloads to complete in parallel
                    console.log(
                      `Starting parallel download of ${downloadPromises.length} files...`
                    );
                    const downloadResults = await Promise.all(downloadPromises);
                    downloadedFiles.push(...downloadResults);
                    console.log(
                      `All ${downloadedFiles.length} files downloaded successfully!`
                    );

                    if (downloadedFiles.length > 0) {
                      // Store files in Redis for potential future use
                      await storeFilesInRedis(downloadedFiles, {
                        groupId: groupId,
                        sourceChannel: fromId,
                        channelName: REFUNDCASH_GROUPS[fromId].name,
                        originalGroupId: message.groupedId?.toString(),
                      });

                      // Process all images using BullMQ queue
                      const chatId =
                        message.chatId?.toString() ||
                        message.peerId?.toString();

                      const imageFiles = downloadedFiles.filter(
                        (file) =>
                          file.type === "photo" ||
                          (file.type === "document" &&
                            file.mimeType?.startsWith("image/"))
                      );

                      if (imageFiles.length > 0) {
                        try {
                          console.log(
                            `Queuing ${imageFiles.length} images for group processing`
                          );

                          // Prepare images for queue
                          const imagesToProcess = imageFiles.map((file) => {
                            const baseFileName = path.basename(
                              file.filePath,
                              path.extname(file.filePath)
                            );
                            const fileExt =
                              path.extname(file.filePath) || ".jpg";

                            return {
                              path: file.filePath,
                              originalname: `${baseFileName}${fileExt}`,
                              mimetype: file.mimeType || "image/jpeg",
                              messageId: file.messageId,
                            };
                          });

                          // Queue all images for processing
                          const jobResult = await processImagesWithQueue(
                            imagesToProcess
                          );

                          // Monitor job and send group when complete
                          const chatId =
                            message.chatId?.toString() ||
                            message.peerId?.toString();
                          monitorGroupJobAndSend(
                            jobResult.jobId,
                            chatId,
                            groupData.messages[0].id,
                            imagesToProcess
                          );
                        } catch (error) {
                          console.error(`Error queuing group images:`, error);
                        }
                      }

                      // Note: Group sending is now handled by monitorGroupJobAndSend function
                    }
                  } finally {
                    // Xóa group sau khi xử lý xong
                    processingMediaGroups.delete(destinationKey);
                  }
                }, 5000), // Đợi 5 giây để nhận đủ messages
              });
            }

            // Lấy group data
            const groupData = processingMediaGroups.get(destinationKey);

            // Nếu group đang xử lý, bỏ qua message
            if (!groupData.processing) {
              // Thêm message vào group
              groupData.messages.push(message);
            }
          } else if (hasMedia && !hasMediaGroup) {
            // Handle single media file
            const timestamp = Date.now();
            // Get file extension from MIME type
            const mimeType = message.media?.document?.mimeType || "";
            const fileExt = getExtensionFromMimeType(mimeType);
            const mediaPath = `media_temp/${timestamp}_${message.id}${fileExt}`;

            const downloadedPath = await client.downloadMedia(message, {
              outputFile: mediaPath,
            });

            // Determine media type - handle photos, videos, and documents
            let mediaType;
            let fileName = null;
            let fileSize = null;

            if (message.media?.className === "MessageMediaPhoto") {
              mediaType = "photo";
            } else if (message.media?.className === "MessageMediaDocument") {
              const document = message.media.document;
              const documentMimeType = document?.mimeType;
              fileSize = document?.size;

              // Get original filename if available
              fileName = document?.attributes?.find(
                (attr) => attr.className === "DocumentAttributeFilename"
              )?.fileName;

              // Check if document is video or other file type
              if (documentMimeType?.startsWith("video/")) {
                mediaType = "video";
              } else if (documentMimeType?.startsWith("image/")) {
                mediaType = "photo";
              } else {
                mediaType = "document";
              }
            } else {
              mediaType = "video"; // fallback for other video types
            }

            const downloadedFiles = [
              {
                type: mediaType,
                filePath: downloadedPath,
                caption: message.message || "",
                messageId: message.id,
                timestamp: timestamp,
                fileName: fileName,
                mimeType: mimeType,
                fileSize: fileSize,
              },
            ];

            // Check if it's an image file and process it with 28news logo
            if (
              mediaType === "photo" ||
              (mediaType === "document" && mimeType?.startsWith("image/"))
            ) {
              console.log(`Detected image file: ${downloadedPath}`);

              // Process image with 28news logo and reply to original message
              await processImageAndReply(client, message, downloadedPath);
            }
          } else {
            // Handle text-only messages
            const messageText = message.text || message.message || "";
            console.log(`Text message from RefundCash: ${messageText}`);

            // No webhook functionality needed
          }
        } catch (error) {
          console.error("Error processing RefundCash message:", error);
        }
      }
    }, filter);
  } catch (error) {
    throw error;
  }
})();
