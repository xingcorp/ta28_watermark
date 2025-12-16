import { Worker } from "bullmq";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import * as dotenv from "dotenv";

dotenv.config();

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegStatic);

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

// Video overlay function with configurable parameters and positioning
async function addLogoToVideo(videoPath, logoPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const {
        logoSize = 15, // percentage of video width (5-100)
        logoOpacity = 0.8, // opacity (0.1-1.0)
        paddingPercent = 0,
        paddingXPercent = paddingPercent,
        paddingYPercent = paddingPercent,
        logoPosition = "bottom-right", // position: top-left, top-right, bottom-left, bottom-right, center
        duration = null, // if specified, trim video to this duration in seconds
      } = options;

      console.log(`Processing video: ${videoPath}`);
      console.log(
        `Logo: ${logoPath}, Position: ${logoPosition}, Size: ${logoSize}%`
      );

      // Get video information first
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("Error getting video metadata:", err);
          return reject(err);
        }

        const videoStream = metadata.streams.find(
          (s) => s.codec_type === "video"
        );
        if (!videoStream) {
          return reject(new Error("No video stream found"));
        }

        const videoWidth = videoStream.width;
        const videoHeight = videoStream.height;
        const videoDuration =
          parseFloat(videoStream.duration) ||
          parseFloat(metadata.format.duration);

        console.log(
          `Video dimensions: ${videoWidth}x${videoHeight}, Duration: ${videoDuration}s`
        );

        // Calculate logo size and position
        const logoPixelSize = Math.floor(videoWidth * (logoSize / 100));

        const paddingX = Math.max(0, Math.round(videoWidth * (paddingXPercent / 100)));
        const paddingY = Math.max(0, Math.round(videoHeight * (paddingYPercent / 100)));

        let overlayPosition;
        switch (logoPosition) {
          case "top-left":
            overlayPosition = `${paddingX}:${paddingY}`;
            break;
          case "top-right":
            overlayPosition = `W-w-${paddingX}:${paddingY}`;
            break;
          case "bottom-left":
            overlayPosition = `${paddingX}:H-h-${paddingY}`;
            break;
          case "bottom-right":
            overlayPosition = `W-w-${paddingX}:H-h-${paddingY}`;
            break;
          case "center":
            overlayPosition = `(W-w)/2:(H-h)/2`;
            break;
          default:
            overlayPosition = `W-w-${paddingX}:H-h-${paddingY}`;
        }

        // Create FFmpeg command
        let command = ffmpeg().input(videoPath).input(logoPath);

        // Apply duration limit if specified
        if (duration && duration > 0 && duration < videoDuration) {
          command = command.duration(duration);
        }

        // Use the most basic overlay approach to avoid segfaults
        const ffmpegThreads = process.env.FFMPEG_THREADS || "0"; // 0 = auto-detect cores

        command
          .complexFilter([
            `[1:v]scale=${logoPixelSize}:-1[logo];[0:v][logo]overlay=${overlayPosition}`,
          ])
          .outputOptions([
            "-c:v",
            "libx264",
            "-preset",
            "medium", // Higher quality encoding
            "-crf",
            "15", // Higher quality (18 = visually lossless)
            "-threads",
            ffmpegThreads, // Use all available CPU threads
            "-c:a",
            "copy", // Copy audio stream without re-encoding
            "-avoid_negative_ts",
            "make_zero", // Fix timestamp issues
            "-movflags",
            "+faststart", // Enable fast streaming
            "-f",
            "mp4",
          ])
          .output(outputPath)
          .on("start", (commandLine) => {
            console.log("FFmpeg command:", commandLine);
          })
          .on("progress", (progress) => {
            if (progress.percent) {
              console.log(
                `Video processing progress: ${Math.round(progress.percent)}%`
              );
            }
          })
          .on("end", () => {
            console.log(`✅ Video processing completed: ${outputPath}`);
            resolve({
              success: true,
              outputPath,
              duration: duration || videoDuration,
            });
          })
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            reject(err);
          })
          .run();
      });
    } catch (error) {
      console.error("Error in addLogoToVideo:", error);
      reject(error);
    }
  });
}

// Process single video for batch job
async function processSingleVideo(
  videoPath,
  originalName,
  mimeType,
  logoPath,
  options,
  customLogoPath,
  generateThumbnail = true,
  jobId
) {
  try {
    // Extract the main job ID (remove -videos suffix if present)
    const mainJobId = jobId.replace(/-videos$/, "");

    // Create job directory using the main jobId for consistency with frontend expectations
    const jobDir = path.join(processedDir, mainJobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    // Save processed video
    const fileName = `${path.parse(originalName).name}_processed.mp4`;
    const filePath = path.join(jobDir, fileName);

    // Process video with logo overlay
    await addLogoToVideo(
      videoPath,
      customLogoPath || logoPath,
      filePath,
      options
    );

    let thumbnailName = null;
    let thumbnailPath = null;

    // Generate thumbnail if requested
    if (generateThumbnail) {
      thumbnailName = `${path.parse(originalName).name}_thumbnail.jpg`;
      thumbnailPath = path.join(jobDir, thumbnailName);

      await new Promise((resolve, reject) => {
        // Generate thumbnail from original video at 2 second mark to avoid black frames
        ffmpeg(videoPath)
          .seekInput(2)
          .outputOptions([
            "-vframes",
            "1",
            "-q:v",
            "2",
            "-vf",
            "scale=800:600:force_original_aspect_ratio=decrease,pad=800:600:(ow-iw)/2:(oh-ih)/2",
          ])
          .output(thumbnailPath)
          .on("start", (commandLine) => {
            console.log("Thumbnail generation command:", commandLine);
          })
          .on("end", () => {
            console.log(`Video thumbnail generated: ${thumbnailName}`);
            resolve();
          })
          .on("error", (err) => {
            console.error("Thumbnail generation error:", err);
            reject(err);
          })
          .run();
      });
    }

    console.log(
      `Video processed: ${fileName}${
        generateThumbnail ? `, Thumbnail: ${thumbnailName}` : ""
      }`
    );

    return {
      originalName,
      fileName,
      thumbnailName,
      filePath,
      thumbnailPath,
    };
  } catch (error) {
    console.error(`Error processing video ${originalName}:`, error);
    throw error;
  }
}

// Get environment suffix for queue names
const envSuffix = process.env.NODE_ENV
  ? `-${process.env.NODE_ENV}`
  : "-development";

// Create a worker to process video jobs
const worker = new Worker(
  `video-processing${envSuffix}`,
  async (job) => {
    const {
      jobId,
      videos,
      logoPath,
      options,
      customLogoPath,
      generateThumbnail = true,
      totalVideos,
    } = job.data;

    console.log(
      `Starting video processing job ${jobId} with ${videos.length} videos`
    );

    const processedVideos = [];
    let completedVideos = 0;

    try {
      // Process each video file
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];

        // Use file path directly from disk storage
        const tempFilePath = video.path;

        try {
          const result = await processSingleVideo(
            tempFilePath,
            video.originalname,
            video.mimetype,
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
          const mainJobId = jobId.replace(/-videos$/, "");
          const processedVideo = {
            originalName: result.originalName,
            // For backward compatibility
            processedVideoUrl: `/processed/${mainJobId}/${result.fileName}`,
            // New fields for thumbnail and full-size video
            thumbnailUrl: generateThumbnail
              ? `/processed/${mainJobId}/${result.thumbnailName}`
              : null,
            fullVideoUrl: `/processed/${mainJobId}/${result.fileName}`,
            status: "completed",
          };

          processedVideos.push(processedVideo);
          completedVideos += 1;

          const progress = Math.floor((completedVideos / videos.length) * 100);

          // Update job progress with additional data
          await job.updateProgress(progress);

          // Update job data with current state for real-time access
          await job.updateData({
            ...job.data,
            currentCompletedVideos: completedVideos,
            currentProcessedVideos: processedVideos.slice(),
            totalVideos: videos.length,
          });

          console.log(
            `Job ${jobId}: Processed ${i + 1}/${
              videos.length
            } videos (${progress}%)`
          );
        } catch (error) {
          console.error(`Error processing video ${video.originalname}:`, error);
          processedVideos.push({
            originalName: video.originalname,
            processedVideoUrl: "",
            thumbnailUrl: "",
            fullVideoUrl: "",
            status: "failed",
            error: error.message,
          });
          completedVideos += 1;

          const progress = Math.floor((completedVideos / videos.length) * 100);
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
        `Job ${jobId} completed successfully with ${processedVideos.length} videos`
      );

      return {
        jobId,
        status: "completed",
        processedVideos,
        totalVideos: videos.length,
        completedVideos,
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
    concurrency: 1, // Process 1 job at a time for large video files
    removeOnComplete: 3, // Keep last 3 completed jobs (videos are large)
    removeOnFail: 10, // Keep last 10 failed jobs
    lockDuration: 1800000, // 30 minutes lock duration for video processing
    lockRenewTime: 900000, // Renew lock every 15 minutes
    stalledInterval: 120000, // Check for stalled jobs every 2 minutes
    maxStalledCount: 2, // Allow 2 stalled attempts before failing
  }
);

// Worker event handlers
worker.on("completed", (job, result) => {
  console.log(`✅ Video job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Video job ${job?.id} failed:`, err.message);
});

worker.on("progress", (job, progress) => {
  console.log(`🔄 Video job ${job.id} progress: ${progress}%`);
});

worker.on("error", (err) => {
  console.error("Video worker error:", err);
});

console.log("🚀 Video processing worker started");
console.log(`⚡ Concurrency: 1 job (optimized for video processing)`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down video worker...");
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down video worker...");
  await worker.close();
  process.exit(0);
});
