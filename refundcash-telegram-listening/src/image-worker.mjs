import { Worker } from "bullmq";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import * as dotenv from "dotenv";

dotenv.config();

// Ensure processed directory exists
const processedDir = path.join(process.cwd(), "processed");
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir, { recursive: true });
}

// Ensure media_temp directory exists
const mediaDir = path.join(process.cwd(), "media_temp");
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Redis connection configuration
const redisConnection = {
  url: process.env.REDIS_URL || "redis://redis:6379/1",
};

// Logo overlay function with configurable parameters and positioning
async function addLogoToImage(
  imageBuffer,
  logoPath,
  originalFormat,
  options = {}
) {
  try {
    const {
      logoSize = 10, // Default scale factor as percentage (1-20)
      logoOpacity = 100, // opacity percentage (10-100)
      paddingPercent = 0, // padding as percentage of image width (1-10)
      paddingXPercent = paddingPercent,
      paddingYPercent = paddingPercent,
      logoPosition = "bottom-right", // position: top-left, top-right, bottom-left, bottom-right, center
    } = options;

    console.log({ logoPath, originalFormat, options });

    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    console.log(`Image dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`Logo positioning: ${logoPosition}`);

    // Get logo metadata to maintain aspect ratio
    const logoMetadata = await sharp(logoPath).metadata();
    const logoOriginalWidth = logoMetadata.width;
    const logoOriginalHeight = logoMetadata.height;

    // Calculate logo size based on image dimensions with consistent scaling
    const logoScale = logoSize / 100; // Convert percentage to decimal
    const newLogoWidth = Math.round(metadata.width * logoScale);
    const newLogoHeight = Math.round(
      newLogoWidth * (logoOriginalHeight / logoOriginalWidth)
    );
    
    // Calculate padding based on image dimensions
    const finalPaddingX = Math.max(0, Math.round(metadata.width * (paddingXPercent / 100)));
    const finalPaddingY = Math.max(0, Math.round(metadata.height * (paddingYPercent / 100)));

    console.log(
      `Logo original dimensions: ${logoOriginalWidth}x${logoOriginalHeight}`
    );
    console.log(`Logo new dimensions: ${newLogoWidth}x${newLogoHeight}`);

    // Process logo with opacity
    let logoBuffer = await sharp(logoPath)
      .resize(newLogoWidth, newLogoHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    // Apply opacity if not 100%
    if (logoOpacity < 100) {
      logoBuffer = await sharp(logoBuffer)
        .composite([
          {
            input: Buffer.from([
              255,
              255,
              255,
              Math.floor(255 * (logoOpacity / 100)),
            ]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();
    }

    // Get resized logo dimensions
    const resizedLogoMetadata = await sharp(logoBuffer).metadata();
    const logoWidth = resizedLogoMetadata.width;
    const logoHeight = resizedLogoMetadata.height;

    // Calculate position based on logoPosition parameter
    let top, left;
    switch (logoPosition) {
      case "top-left":
        top = finalPaddingY;
        left = finalPaddingX;
        break;
      case "top-right":
        top = finalPaddingY;
        left = metadata.width - logoWidth - finalPaddingX;
        break;
      case "bottom-left":
        top = metadata.height - logoHeight - finalPaddingY;
        left = finalPaddingX;
        break;
      case "bottom-right":
        top = metadata.height - logoHeight - finalPaddingY;
        left = metadata.width - logoWidth - finalPaddingX;
        break;
      case "center":
        top = Math.floor((metadata.height - logoHeight) / 2);
        left = Math.floor((metadata.width - logoWidth) / 2);
        break;
      default:
        // Default to bottom-right
        top = metadata.height - logoHeight - finalPaddingY;
        left = metadata.width - logoWidth - finalPaddingX;
    }

    console.log(`Logo dimensions: ${logoWidth}x${logoHeight}`);
    console.log(`Logo position: top=${top}, left=${left}`);
    console.log(`Image dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`Final logo size: ${newLogoWidth}x${newLogoHeight}`);

    // Position logo with calculated coordinates
    console.log(
      `Applying logo at coordinates: top=${Math.max(0, top)}, left=${Math.max(
        0,
        left
      )}`
    );
    let processedImage = image.composite([
      {
        input: logoBuffer,
        top: Math.max(0, top),
        left: Math.max(0, left),
      },
    ]);

    // Preserve original format and quality
    if (originalFormat === "jpeg" || originalFormat === "jpg") {
      processedImage = processedImage.jpeg({ quality: 100, mozjpeg: true });
    } else if (originalFormat === "png") {
      processedImage = processedImage.png({
        compressionLevel: 0,
        quality: 100,
      });
    } else if (originalFormat === "webp") {
      processedImage = processedImage.webp({ quality: 100, lossless: true });
    } else {
      // Default to PNG for other formats to preserve quality
      processedImage = processedImage.png({
        compressionLevel: 0,
        quality: 100,
      });
    }

    const result = await processedImage.toBuffer();
    return result;
  } catch (error) {
    console.error("Error adding logo to image:", error);
    throw error;
  }
}

// Process single image for batch job
async function processSingleImage(
  imagePath,
  originalName,
  mimeType,
  logoPath,
  options,
  customLogoPath,
  generateThumbnail = true,
  jobId
) {
  try {
    const originalFormat = originalName.split(".").pop().toLowerCase();

    // Process image with logo overlay
    const processedBuffer = await addLogoToImage(
      fs.readFileSync(imagePath),
      logoPath,
      originalFormat,
      options
    );

    // Extract the main job ID (remove -images suffix if present)
    const mainJobId = jobId.replace(/-images$/, '');
    
    // Create job directory using the main jobId for consistency with frontend expectations
    const jobDir = path.join(processedDir, mainJobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    // Save full-size processed image (high quality)
    const fileName = `${path.parse(originalName).name}_processed.jpg`;
    const filePath = path.join(jobDir, fileName);

    await sharp(processedBuffer).jpeg({ quality: 100 }).toFile(filePath);

    let thumbnailName = null;
    let thumbnailPath = null;

    // Generate thumbnail only if requested
    if (generateThumbnail) {
      thumbnailName = `${path.parse(originalName).name}_thumbnail.jpg`;
      thumbnailPath = path.join(jobDir, thumbnailName);

      await sharp(processedBuffer)
        .resize(800, 800, {
          fit: "inside",
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3,
        })
        .jpeg({
          quality: 75,
          progressive: true,
          mozjpeg: true,
        })
        .toFile(thumbnailPath);

      console.log(`Image processed: ${fileName}, Thumbnail: ${thumbnailName}`);
    } else {
      console.log(`Image processed: ${fileName} (no thumbnail)`);
    }

    return {
      originalName,
      fileName,
      thumbnailName,
      filePath,
      thumbnailPath,
    };
  } catch (error) {
    console.error(`Error processing image ${originalName}:`, error);
    throw error;
  }
}

// Get environment suffix for queue names
const envSuffix = process.env.NODE_ENV ? `-${process.env.NODE_ENV}` : '-development';

// Create the image processing worker
const imageWorker = new Worker(
  `image-processing${envSuffix}`,
  async (job) => {
    const {
      jobId,
      images,
      logoPath,
      options,
      customLogoPath,
      generateThumbnail,
      totalImages,
    } = job.data;

    console.log(
      `Starting image processing job ${jobId} with ${images.length} images`
    );

    const processedImages = [];
    let completedImages = 0;

    try {
      // Save uploaded files to temp directory
      const tempDir = path.join(process.cwd(), "temp_uploads");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Process each image file
      for (let i = 0; i < images.length; i++) {
        const image = images[i];

        // Use file path directly from disk storage
        const tempFilePath = image.path;

        try {
          const result = await processSingleImage(
            tempFilePath,
            image.originalname,
            image.mimetype,
            logoPath,
            options,
            customLogoPath,
            generateThumbnail,
            jobId
          );

          // Cleanup temp file after processing
          try {
            fs.unlinkSync(tempFilePath);
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup temp file: ${tempFilePath}`,
              cleanupError.message
            );
          }

          // Transform result to include all required URLs using main job ID
          const mainJobId = jobId.replace(/-images$/, '');
          const processedImage = {
            originalName: result.originalName,
            // For backward compatibility
            processedImageUrl: `/processed/${mainJobId}/${result.fileName}`,
            // New fields for thumbnail and full-size image
            thumbnailUrl: generateThumbnail
              ? `/processed/${mainJobId}/${result.thumbnailName}`
              : null,
            fullImageUrl: `/processed/${mainJobId}/${result.fileName}`,
            status: "completed",
          };

          processedImages.push(processedImage);
          completedImages += 1;

          const progress = Math.floor((completedImages / images.length) * 100);

          // Update job progress with additional data
          await job.updateProgress(progress);

          // Update job data with current state for real-time access
          await job.updateData({
            ...job.data,
            currentCompletedImages: completedImages,
            currentProcessedImages: processedImages.slice(),
            totalImages: images.length,
          });

          console.log(
            `Job ${jobId}: Processed ${i + 1}/${
              images.length
            } images (${progress}%)`
          );
        } catch (error) {
          console.error(`Error processing image ${image.originalname}:`, error);
          processedImages.push({
            originalName: image.originalname,
            processedImageUrl: "",
            thumbnailUrl: "",
            fullImageUrl: "",
            status: "failed",
            error: error.message,
          });
          completedImages += 1;

          const progress = Math.floor((completedImages / images.length) * 100);
          await job.updateProgress(progress);
        }
      }

      // Clean up temporary logo file if used
      if (customLogoPath) {
        try {
          fs.unlinkSync(customLogoPath);
          console.log(`Cleaned up custom logo file: ${customLogoPath}`);
        } catch (err) {
          console.warn(
            `Failed to cleanup logo file for job ${jobId}:`,
            err.message
          );
        }
      }

      console.log(
        `Job ${jobId} completed successfully with ${processedImages.length} images`
      );

      return {
        jobId,
        status: "completed",
        processedImages,
        totalImages: images.length,
        completedImages,
        progress: 100,
      };
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);

      // Clean up on failure
      if (customLogoPath) {
        try {
          fs.unlinkSync(customLogoPath);
        } catch (err) {
          console.warn(`Failed to cleanup logo file on error:`, err.message);
        }
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process 1 job at a time for large files
    removeOnComplete: 5, // Keep last 5 completed jobs
    removeOnFail: 20, // Keep last 20 failed jobs
    lockDuration: 300000, // 5 minutes lock duration for long-running jobs
    lockRenewTime: 150000, // Renew lock every 2.5 minutes
    stalledInterval: 60000, // Check for stalled jobs every minute
    maxStalledCount: 3, // Allow 3 stalled attempts before failing
  }
);

// Worker event handlers
imageWorker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

imageWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

imageWorker.on("progress", (job, progress) => {
  console.log(`🔄 Job ${job.id} progress: ${progress}%`);
});

imageWorker.on("error", (err) => {
  console.error("Worker error:", err);
});

console.log("🚀 Image processing worker started");
console.log(`⚡ Concurrency: 1 job`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down image worker...");
  await imageWorker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down image worker...");
  await imageWorker.close();
  process.exit(0);
});
