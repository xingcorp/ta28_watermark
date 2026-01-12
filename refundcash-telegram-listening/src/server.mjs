import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createClient } from "redis";
import fs from "fs";
import path from "path";
import { formidable } from "formidable";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import {
  addImageProcessingJob,
  addVideoProcessingJob,
  getJobStatus,
  cancelJob,
  getQueueStats,
  imageQueue,
  videoQueue,
} from "./queue-utils.mjs";

const app = express();
const port = process.env.DOWNLOAD_PORT || 3000;

// Helper function to determine if a file is a video
function isVideoFile(mimetype, filename) {
  const videoMimeTypes = [
    'video/mp4',
    'video/avi',
    'video/mov',
    'video/wmv',
    'video/flv',
    'video/webm',
    'video/mkv',
    'video/m4v',
    'video/3gp',
    'video/quicktime'
  ];
  
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp', '.qt'];
  
  if (mimetype && videoMimeTypes.includes(mimetype.toLowerCase())) {
    return true;
  }
  
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    return videoExtensions.includes(ext);
  }
  
  return false;
}

// Helper function to determine if a file is an image
function isImageFile(mimetype, filename) {
  const imageMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff'
  ];
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
  
  if (mimetype && imageMimeTypes.includes(mimetype.toLowerCase())) {
    return true;
  }
  
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    return imageExtensions.includes(ext);
  }
  
  return false;
}

// Configure Formidable for optimized file uploads
const createFormidableForm = (options = {}) => {
  const uploadDir = path.join(process.cwd(), "temp_uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  return formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 1.6 * 1024 * 1024 * 1024, // 1.6GB per file
    maxFiles: 400, // Max 400 files
    maxFields: 800, // Increased proportionally
    multiples: true,
    allowEmptyFiles: false,
    minFileSize: 1,
    hashAlgorithm: 'md5', // For file integrity checking
    ...options
  });
};

// Upload progress tracking
const uploadProgress = new Map();
const activeUploads = new Map();

// Function to update upload progress from job progress
const updateUploadProgressFromJob = (uploadId, job) => {
  if (!uploadId) return;
  
  // Get existing progress or create default values
  const existingProgress = uploadProgress.get(uploadId) || { received: 0, total: 0, progress: 0 };
  
  // Only update the phase and processing progress, preserve upload data
  const jobProgress = job.progress || 0;
  
  uploadProgress.set(uploadId, {
    // Keep original upload data
    received: existingProgress.received || 0,
    total: existingProgress.total || 0,
    progress: existingProgress.progress || 0,
    // Add processing information
    processingProgress: jobProgress,
    phase: job.finishedOn ? 'completed' : 'processing',
    timestamp: Date.now()
  });
  
  console.log(`Updated progress for upload ${uploadId}: Upload progress ${existingProgress.progress || 0}%, Processing progress ${jobProgress}%`);
};

// Ensure media_temp directory exists
const mediaDir = path.join(process.cwd(), "media_temp");
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Ensure processed directory exists
const processedDir = path.join(process.cwd(), "processed");
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir, { recursive: true });
}

// Configure automatic cleanup for processed media
const processedMediaTtlMinutes = Math.max(
  5,
  Math.min(
    24 * 60,
    parseInt(process.env.PROCESSED_MEDIA_TTL_MINUTES || "60", 10)
  )
);
const processedMediaCleanupIntervalMinutes = Math.max(
  5,
  Math.min(
    processedMediaTtlMinutes,
    parseInt(
      process.env.PROCESSED_MEDIA_CLEANUP_INTERVAL_MINUTES || "10",
      10
    )
  )
);

console.log(
  `[CLEANUP] Processed media TTL: ${processedMediaTtlMinutes} minutes, cleanup interval: ${processedMediaCleanupIntervalMinutes} minutes`
);

// Cleanup old job directories periodically based on TTL
setInterval(() => {
  const cutoffTime = new Date(
    Date.now() - processedMediaTtlMinutes * 60 * 1000
  );
  let cleanedCount = 0;

  try {
    const jobDirs = fs.readdirSync(processedDir);

    for (const jobDir of jobDirs) {
      const jobDirPath = path.join(processedDir, jobDir);
      const stats = fs.statSync(jobDirPath);

      if (stats.isDirectory() && stats.mtime < cutoffTime) {
        try {
          fs.rmSync(jobDirPath, { recursive: true, force: true });
          cleanedCount++;
        } catch (error) {
          console.warn(`Failed to cleanup directory ${jobDir}:`, error.message);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `[CLEANUP] Removed ${cleanedCount} processed job directories older than ${processedMediaTtlMinutes} minutes`
      );
    }
  } catch (error) {
    console.warn(
      "[CLEANUP] Error during processed media cleanup:",
      error.message
    );
  }
}, processedMediaCleanupIntervalMinutes * 60 * 1000);

// Logo overlay function with configurable parameters and positioning
async function addLogoToImage(
  imageBuffer,
  logoPath,
  originalFormat,
  options = {}
) {
  try {
    const {
      logoSize = 15, // percentage of image width (5-100)
      logoOpacity = 100, // opacity percentage (10-100)
      paddingPercent = 0,
      paddingXPercent = paddingPercent,
      paddingYPercent = paddingPercent,
      logoPosition = "bottom-right", // position: top-left, top-right, bottom-left, bottom-right, center
    } = options;

    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    const paddingX = Math.max(0, Math.round(metadata.width * (paddingXPercent / 100)));
    const paddingY = Math.max(0, Math.round(metadata.height * (paddingYPercent / 100)));

    // Calculate logo size based on percentage
    const logoPixelSize = Math.floor(
      Math.min(metadata.width, metadata.height) * (logoSize / 100)
    );

    // Process logo with opacity
    let logoBuffer = await sharp(logoPath)
      .resize(logoPixelSize, logoPixelSize, {
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

    // Calculate position based on logoPosition parameter
    const logoMetadata = await sharp(logoBuffer).metadata();
    const logoWidth = logoMetadata.width;
    const logoHeight = logoMetadata.height;

    let top, left;
    switch (logoPosition) {
      case "top-left":
        top = paddingY;
        left = paddingX;
        break;
      case "top-right":
        top = paddingY;
        left = metadata.width - logoWidth - paddingX;
        break;
      case "bottom-left":
        top = metadata.height - logoHeight - paddingY;
        left = paddingX;
        break;
      case "bottom-right":
        top = metadata.height - logoHeight - paddingY;
        left = metadata.width - logoWidth - paddingX;
        break;
      case "center":
        top = Math.floor((metadata.height - logoHeight) / 2);
        left = Math.floor((metadata.width - logoWidth) / 2);
        break;
      default:
        // Default to bottom-right
        top = metadata.height - logoHeight - paddingY;
        left = metadata.width - logoWidth - paddingX;
    }

    // Position logo with calculated coordinates
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

// Note: Image processing functions moved to image-worker.mjs

// Initialize Redis client
const redisUrl = process.env.REDIS_URL || "redis://redis:6379/1";
const redis = createClient({
  url: redisUrl,
});

await redis.connect();
console.log("✓ Redis connected for download server");

// Enable JSON parsing for requests with streaming
app.use(express.json({ limit: "1gb" }));
app.use(express.raw({ limit: "1gb", type: "application/octet-stream" }));

// Global CORS middleware for all routes
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Content-Length"
  );
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Type"
  );

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  next();
});

// Serve static files (for test page) with CORS headers
app.use(
  express.static(process.cwd(), {
    setHeaders: (res, path) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET");
    },
  })
);

// Optimized batch job submission with Formidable
app.post("/submit-batch-job", async (req, res) => {
  const uploadId = `upload-${uuidv4()}`;
  let form;
  
  try {
    // Create Formidable form with progress tracking
    form = createFormidableForm({
      onProgress: (bytesReceived, bytesExpected) => {
        const progress = bytesExpected > 0 ? Math.round((bytesReceived / bytesExpected) * 100) : 0;
        uploadProgress.set(uploadId, {
          received: bytesReceived,
          total: bytesExpected,
          progress,
          phase: 'uploading',
          timestamp: Date.now()
        });
      }
    });

    // Parse form with streaming
    const [fields, files] = await form.parse(req);
    
    // Extract media files (images and videos) and logo files
    const imageFiles = [];
    const videoFiles = [];
    let logoFile = null;
    
    Object.entries(files).forEach(([fieldname, fileArray]) => {
      const fileList = Array.isArray(fileArray) ? fileArray : [fileArray];
      fileList.forEach(file => {
        if (fieldname === 'files' || fieldname === 'media' || fieldname.startsWith('image') || fieldname.startsWith('video')) {
          // Validate and categorize media files
          if (isImageFile(file.mimetype, file.originalFilename)) {
            imageFiles.push({
              originalname: file.originalFilename || file.newFilename,
              mimetype: file.mimetype,
              path: file.filepath,
              size: file.size,
              hash: file.hash
            });
          } else if (isVideoFile(file.mimetype, file.originalFilename)) {
            videoFiles.push({
              originalname: file.originalFilename || file.newFilename,
              mimetype: file.mimetype,
              path: file.filepath,
              size: file.size,
              hash: file.hash
            });
          }
        } else if (fieldname === 'logo' || fieldname === 'customLogo') {
          if (file.mimetype && file.mimetype.startsWith('image/')) {
            logoFile = {
              originalname: file.originalFilename || file.newFilename,
              mimetype: file.mimetype,
              path: file.filepath,
              size: file.size,
              hash: file.hash
            };
          }
        }
      });
    });

    const totalMediaFiles = imageFiles.length + videoFiles.length;
    if (totalMediaFiles === 0) {
      return res.status(400).json({
        success: false,
        jobId: "",
        error: "No valid image or video files provided",
      });
    }

    // Validate total upload size (40GB limit)
    const totalUploadSize = [...imageFiles, ...videoFiles].reduce((sum, file) => sum + file.size, 0);
    const maxTotalSize = 40 * 1024 * 1024 * 1024; // 40GB
    if (totalUploadSize > maxTotalSize) {
      return res.status(413).json({
        success: false,
        jobId: "",
        error: `Total upload size (${(totalUploadSize / (1024 * 1024 * 1024)).toFixed(2)}GB) exceeds maximum limit of 40GB`,
        totalSize: totalUploadSize,
        maxSize: maxTotalSize
      });
    }

    // Parse and validate parameters
    const logoPosition = (fields.logoPosition?.[0] || "bottom-right").toString();
    const logoSize = parseInt(fields.logoSize?.[0] || "15");
    const logoOpacity = parseInt(fields.logoOpacity?.[0] || "80");

    const paddingPercentFallback = fields.paddingPercent?.[0];
    const paddingXPercentRaw = fields.paddingXPercent?.[0] ?? paddingPercentFallback;
    const paddingYPercentRaw = fields.paddingYPercent?.[0] ?? paddingPercentFallback;
    const paddingXPercent = paddingXPercentRaw !== undefined ? Number(paddingXPercentRaw) : 0;
    const paddingYPercent = paddingYPercentRaw !== undefined ? Number(paddingYPercentRaw) : 0;

    // Validation
    const validPositions = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
    if (!validPositions.includes(logoPosition)) {
      return res.status(400).json({
        success: false,
        jobId: "",
        error: "Invalid logo position",
      });
    }

    if (logoSize < 5 || logoSize > 100) {
      return res.status(400).json({
        success: false,
        jobId: "",
        error: "Logo size must be between 5 and 100 percent",
      });
    }

    if (logoOpacity < 10 || logoOpacity > 100) {
      return res.status(400).json({
        success: false,
        jobId: "",
        error: "Logo opacity must be between 10 and 100 percent",
      });
    }

    if (
      Number.isNaN(paddingXPercent) ||
      Number.isNaN(paddingYPercent) ||
      paddingXPercent < 0 ||
      paddingXPercent > 20 ||
      paddingYPercent < 0 ||
      paddingYPercent > 20
    ) {
      return res.status(400).json({
        success: false,
        jobId: "",
        error: "Padding must be between 0 and 20 percent",
      });
    }

    // Generate job ID
    const jobId = `job-${uuidv4()}`;

    // Determine logo path
    let logoPath;
    if (logoFile) {
      logoPath = logoFile.path;
    } else {
      logoPath = path.join(process.cwd(), "images", "28news-logo.png");
      if (!fs.existsSync(logoPath)) {
        return res.status(500).json({
          success: false,
          jobId: "",
          error: "Default logo file not found",
        });
      }
    }

    // Update progress to processing phase - maintain upload progress data
    const currentProgress = uploadProgress.get(uploadId) || { received: 0, total: 0, progress: 0 };
    uploadProgress.set(uploadId, {
      received: currentProgress.received || 0,
      total: currentProgress.total || 0,
      progress: currentProgress.progress || 0,
      processingProgress: 0,
      processingTotal: totalMediaFiles,
      phase: 'processing',
      timestamp: Date.now(),
      jobId // Store the jobId for faster lookups
    });

    // Create separate jobs for images and videos
    const jobs = [];
    
    if (imageFiles.length > 0) {
      const imageJobId = `${jobId}-images`;
      const imageJob = await addImageProcessingJob({
        jobId: imageJobId,
        images: imageFiles,
        logoPath,
        options: {
          logoSize,
          logoOpacity,
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        },
        customLogoPath: logoFile ? logoFile.path : null,
        priority: 1,
        source: "batch-server",
        uploadId, // Link to upload progress
        initialProgress: uploadProgress.get(uploadId) // Pass initial progress data
      });
      jobs.push({ type: 'image', jobId: imageJobId, count: imageFiles.length });
      console.log(`✅ Image batch job ${imageJobId} submitted with ${imageFiles.length} images`);
    }

    if (videoFiles.length > 0) {
      const videoJobId = `${jobId}-videos`;
      const videoJob = await addVideoProcessingJob({
        jobId: videoJobId,
        videos: videoFiles,
        logoPath,
        options: {
          logoSize: logoSize,
          logoOpacity: logoOpacity / 100, // Convert to 0-1 range for FFmpeg
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        },
        customLogoPath: logoFile ? logoFile.path : null,
        priority: 1,
        source: "batch-server",
        uploadId, // Link to upload progress
        initialProgress: uploadProgress.get(uploadId) // Pass initial progress data
      });
      jobs.push({ type: 'video', jobId: videoJobId, count: videoFiles.length });
      console.log(`✅ Video batch job ${videoJobId} submitted with ${videoFiles.length} videos`);
    }

    console.log(`✅ Mixed media batch job ${jobId} submitted with ${imageFiles.length} images and ${videoFiles.length} videos (Upload ID: ${uploadId})`);

    return res.json({
      success: true,
      jobId,
      uploadId,
      totalFiles: totalMediaFiles,
      imageFiles: imageFiles.length,
      videoFiles: videoFiles.length,
      jobs: jobs,
      message: "Mixed media job submitted successfully",
      features: {
        progressTracking: true,
        fileIntegrityCheck: true,
        streamingUpload: true,
        videoProcessing: true,
        mixedMedia: true
      }
    });

  } catch (error) {
    console.error("Batch job submission error:", error);
    
    // Cleanup uploaded files on error
    if (form && form.openedFiles) {
      form.openedFiles.forEach(file => {
        try {
          fs.unlinkSync(file.filepath);
        } catch (e) {
          console.warn(`Failed to cleanup file: ${file.filepath}`);
        }
      });
    }

    return res.status(500).json({
      success: false,
      jobId: "",
      uploadId,
      error: error.message,
    });
  }
});

// Job status polling endpoint
app.get("/job-status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    // For mixed media jobs, we need to aggregate status from both image and video sub-jobs
    let imageJobStatus = null;
    let videoJobStatus = null;
    let mainJobStatus = await getJobStatus(jobId);
    
    // Check for sub-jobs (mixed media processing)
    const imageJobId = `${jobId}-images`;
    const videoJobId = `${jobId}-videos`;
    
    try {
      imageJobStatus = await getJobStatus(imageJobId);
    } catch (e) {
      // Image job doesn't exist, which is fine
    }
    
    try {
      videoJobStatus = await getJobStatus(videoJobId);
    } catch (e) {
      // Video job doesn't exist, which is fine
    }
    
    // If we have sub-jobs, aggregate their status
    let jobStatus = null;
    if (imageJobStatus || videoJobStatus) {
      // Aggregate status from sub-jobs
      const allJobs = [imageJobStatus, videoJobStatus].filter(Boolean);
      
      if (allJobs.length > 0) {
        // Use the most recent job for base data, but aggregate results
        jobStatus = allJobs[0];
        
        // Aggregate processed results from all sub-jobs
        const allProcessedImages = [];
        const allProcessedVideos = [];
        let totalImages = 0;
        let totalVideos = 0;
        let completedImages = 0;
        let completedVideos = 0;
        let overallProgress = 0;
        let overallStatus = 'pending';
        
        allJobs.forEach(job => {
          const result = job.returnvalue || {};
          const jobData = job.data || {};
          
          // Handle images
          if (result.processedImages) {
            allProcessedImages.push(...result.processedImages);
          } else if (jobData.currentProcessedImages) {
            allProcessedImages.push(...jobData.currentProcessedImages);
          }
          
          // Handle videos
          if (result.processedVideos) {
            allProcessedVideos.push(...result.processedVideos);
          } else if (jobData.currentProcessedVideos) {
            allProcessedVideos.push(...jobData.currentProcessedVideos);
          }
          
          totalImages += result.totalImages || jobData.totalImages || 0;
          totalVideos += result.totalVideos || jobData.totalVideos || 0;
          completedImages += result.completedImages || jobData.currentCompletedImages || 0;
          completedVideos += result.completedVideos || jobData.currentCompletedVideos || 0;
          
          // Calculate weighted progress
          const jobProgress = job.progress || 0;
          const jobWeight = (result.totalImages || jobData.totalImages || 0) + (result.totalVideos || jobData.totalVideos || 0) || 1;
          overallProgress += (jobProgress * jobWeight);
          
          // Determine overall status (failed > processing > completed > pending)
          if (job.status === 'failed') {
            overallStatus = 'failed';
          } else if (job.status === 'active' && overallStatus !== 'failed') {
            overallStatus = 'processing';
          } else if (job.status === 'completed' && overallStatus !== 'failed' && overallStatus !== 'processing') {
            overallStatus = 'completed';
          }
        });
        
        // Calculate final weighted progress
        const totalItems = totalImages + totalVideos;
        if (totalItems > 0) {
          overallProgress = Math.round(overallProgress / totalItems);
        }
        
        // Override aggregated values
        jobStatus.returnvalue = {
          ...jobStatus.returnvalue,
          totalImages,
          totalVideos,
          completedImages,
          completedVideos,
          processedImages: allProcessedImages,
          processedVideos: allProcessedVideos,
          status: overallStatus
        };
        jobStatus.progress = overallProgress;
        jobStatus.status = overallStatus === 'processing' ? 'active' : overallStatus;
      }
    } else if (mainJobStatus) {
      // Use main job status if no sub-jobs found
      jobStatus = mainJobStatus;
      
      // If this is a video job, ensure video fields are properly set
      if (jobStatus.isVideoJob) {
        const result = jobStatus.returnvalue || {};
        const jobData = jobStatus.data || {};
        
        // Map video job fields to the expected format
        jobStatus.returnvalue = {
          ...result,
          totalVideos: result.totalVideos || jobData.totalVideos || 0,
          completedVideos: result.completedVideos || jobData.currentCompletedVideos || 0,
          processedVideos: result.processedVideos || jobData.currentProcessedVideos || [],
          totalImages: 0,
          completedImages: 0,
          processedImages: []
        };
      }
    }
    
    if (!jobStatus) {
      return res.status(404).json({
        jobId,
        status: "failed",
        progress: 0,
        totalImages: 0,
        completedImages: 0,
        processedImages: [],
        error: "Job not found",
      });
    }
    
    // Update upload progress if this job has an associated uploadId
    if (jobStatus.data && jobStatus.data.uploadId) {
      updateUploadProgressFromJob(jobStatus.data.uploadId, jobStatus);
    }

    // Transform BullMQ status to our format
    const result = jobStatus.returnvalue || {};
    const jobData = jobStatus.data || {};

    let response = {
      jobId,
      status: jobStatus.status,
      progress: jobStatus.progress || 0,
      totalImages: result.totalImages || jobData.totalImages || 0,
      totalVideos: result.totalVideos || jobData.totalVideos || 0,
      completedImages:
        result.completedImages || jobData.currentCompletedImages || 0,
      completedVideos:
        result.completedVideos || jobData.currentCompletedVideos || 0,
      processedImages:
        result.processedImages || jobData.currentProcessedImages || [],
      processedVideos:
        result.processedVideos || jobData.currentProcessedVideos || [],
      error: jobStatus.failedReason || null,
      queuedAt: new Date(jobStatus.timestamp).toISOString(),
      startedAt: jobStatus.processedOn
        ? new Date(jobStatus.processedOn).toISOString()
        : null,
      completedAt: jobStatus.finishedOn
        ? new Date(jobStatus.finishedOn).toISOString()
        : null,
    };

    // Cleanup files when job is completed
    if (jobStatus.status === 'completed' && jobData.images) {
      try {
        const tempUploadsDir = path.join(process.cwd(), 'temp_uploads');
        const filesToCleanup = [];
        
        // Add job-specific image files
        jobData.images.forEach(image => {
          if (image.path && fs.existsSync(image.path)) {
            filesToCleanup.push(image.path);
          }
        });
        
        // Add custom logo if used and exists
        if (jobData.customLogoPath && fs.existsSync(jobData.customLogoPath)) {
          filesToCleanup.push(jobData.customLogoPath);
        }
        
        // Cleanup all files
        filesToCleanup.forEach(filePath => {
          try {
            fs.unlinkSync(filePath);
            console.log(`[CLEANUP] Cleaned up file: ${filePath}`);
          } catch (err) {
            console.warn(`[CLEANUP] Failed to cleanup file: ${filePath}`, err.message);
          }
        });
        
        response.cleanupCompleted = true;
        response.cleanedFiles = filesToCleanup.length;
      } catch (cleanupError) {
        console.error('[CLEANUP] Error during cleanup:', cleanupError);
        response.cleanupCompleted = false;
        response.cleanupError = cleanupError.message;
      }
    }

    return res.json(response);
  } catch (error) {
    console.error("Job status error:", error);
    return res.status(500).json({
      jobId: req.params.jobId,
      status: "failed",
      progress: 0,
      totalImages: 0,
      completedImages: 0,
      processedImages: [],
      error: error.message,
    });
  }
});

// Queue status monitoring endpoint
app.get("/queue-status", async (req, res) => {
  try {
    const stats = await getQueueStats();
    return res.json(stats);
  } catch (error) {
    console.error("Queue status error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Cancel job endpoint
app.post("/cancel-job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const cancelled = await cancelJob(jobId);

    if (cancelled) {
      return res.json({
        success: true,
        message: `Job ${jobId} cancelled successfully`,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Job cannot be cancelled (not found or already completed)",
      });
    }
  } catch (error) {
    console.error("Cancel job error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Processed image serving endpoint
app.get("/processed/:jobId/:filename", (req, res) => {
  try {
    const { jobId, filename } = req.params;
    const filePath = path.join(processedDir, jobId, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    const mimeType =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : "application/octet-stream";

    // Add comprehensive CORS headers for cross-origin image access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control"
    );
    res.setHeader("Access-Control-Allow-Credentials", "false");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=14400"); // Cache for 4 hours

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("File serving error:", error);
    res.status(500).json({ error: "Error serving file" });
  }
});

// Optimized single media upload with Formidable (supports both images and videos)
app.post("/upload-media", async (req, res) => {
  const uploadId = `single-${uuidv4()}`;
  let form;
  
  try {
    // Create form with progress tracking
    form = createFormidableForm({
      onProgress: (bytesReceived, bytesExpected) => {
        const progress = bytesExpected > 0 ? Math.round((bytesReceived / bytesExpected) * 100) : 0;
        uploadProgress.set(uploadId, {
          received: bytesReceived,
          total: bytesExpected,
          progress,
          phase: 'uploading',
          timestamp: Date.now()
        });
      }
    });

    const [fields, files] = await form.parse(req);
    
    // Find main media file and custom logo
    let mainMedia = null;
    let customLogo = null;
    let isVideo = false;
    
    Object.entries(files).forEach(([fieldname, fileArray]) => {
      const fileList = Array.isArray(fileArray) ? fileArray : [fileArray];
      fileList.forEach(file => {
        if ((fieldname === 'media' || fieldname === 'image' || fieldname === 'video') && !mainMedia) {
          if (isImageFile(file.mimetype, file.originalFilename)) {
            mainMedia = file;
            isVideo = false;
          } else if (isVideoFile(file.mimetype, file.originalFilename)) {
            mainMedia = file;
            isVideo = true;
          }
        } else if (fieldname === 'customLogo' && file.mimetype?.startsWith('image/')) {
          customLogo = file;
        }
      });
    });

    if (!mainMedia) {
      return res.status(400).json({ error: "No valid image or video file provided" });
    }

    console.log(`Processing ${isVideo ? 'video' : 'image'} upload: ${mainMedia.originalFilename}`);

    // Parse parameters with better validation
    const logoType = fields.logoType?.[0] || "default";
    const logoSize = Math.max(5, Math.min(100, parseInt(fields.logoSize?.[0] || "15")));
    const logoOpacity = Math.max(10, Math.min(100, parseInt(fields.logoOpacity?.[0] || "100")));
    const paddingPercentFallback = fields.paddingPercent?.[0];
    const paddingXPercentRaw = fields.paddingXPercent?.[0] ?? paddingPercentFallback;
    const paddingYPercentRaw = fields.paddingYPercent?.[0] ?? paddingPercentFallback;
    const paddingXPercent = paddingXPercentRaw !== undefined ? Number(paddingXPercentRaw) : 0;
    const paddingYPercent = paddingYPercentRaw !== undefined ? Number(paddingYPercentRaw) : 0;
    const logoPosition = fields.logoPosition?.[0] || "bottom-right";

    if (
      Number.isNaN(paddingXPercent) ||
      Number.isNaN(paddingYPercent) ||
      paddingXPercent < 0 ||
      paddingXPercent > 20 ||
      paddingYPercent < 0 ||
      paddingYPercent > 20
    ) {
      return res.status(400).json({ error: "Padding must be between 0 and 20 percent" });
    }

    // Update progress to processing - maintain upload progress data
    const currentUploadProgress = uploadProgress.get(uploadId) || { received: 0, total: 0, progress: 0 };
    uploadProgress.set(uploadId, {
      received: currentUploadProgress.received || 0,
      total: currentUploadProgress.total || 0,
      progress: currentUploadProgress.progress || 0,
      processingProgress: 0,
      processingTotal: 1,
      phase: 'processing',
      timestamp: Date.now(),
      jobId // Store the jobId for faster lookups
    });

    // Determine logo path
    let logoPath;
    if (logoType === "custom" && customLogo) {
      logoPath = customLogo.filepath;
      console.log(`Using custom logo: ${customLogo.originalFilename}`);
    } else {
      logoPath = path.join(process.cwd(), "images", "28news-logo.png");
      if (!fs.existsSync(logoPath)) {
        return res.status(500).json({
          error: "Default logo file not found",
          message: "The 28news logo file is missing from the server.",
        });
      }
    }

    let processedBuffer;
    let fileName;
    let fileId = uuidv4();
    let filePath;

    if (isVideo) {
      // Process video
      const originalFormat = path.extname(mainMedia.originalFilename).toLowerCase().slice(1) || 'mp4';
      fileName = `processed_${Date.now()}_${mainMedia.originalFilename?.replace(/\.[^/.]+$/, "") || 'video'}.mp4`;
      filePath = path.join(mediaDir, fileName);

      // For videos, we'll create a job and return the jobId for status tracking
      const videoJobId = `single-video-${uuidv4()}`;
      
      await addVideoProcessingJob({
        jobId: videoJobId,
        videos: [{
          originalname: mainMedia.originalFilename,
          mimetype: mainMedia.mimetype,
          path: mainMedia.filepath,
          size: mainMedia.size,
          hash: mainMedia.hash
        }],
        logoPath,
        options: {
          logoSize,
          logoOpacity: logoOpacity / 100, // Convert to 0-1 range for FFmpeg
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        },
        customLogoPath: logoType === "custom" && customLogo ? customLogo.filepath : null,
        priority: 1,
        source: "single-upload",
        uploadId,
      });

      // Store video metadata in Redis
      const videoMetadata = {
        fileId,
        fileName,
        originalFileName: mainMedia.originalFilename,
        mimeType: mainMedia.mimetype,
        uploadedAt: new Date().toISOString(),
        processedWith: logoType === "custom" ? "custom-logo" : "28news-logo",
        hash: mainMedia.hash,
        isVideo: true,
        jobId: videoJobId,
        logoOptions: {
          logoType,
          logoSize,
          logoOpacity,
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        },
      };

      await redis.setEx(`file:${fileId}`, 4 * 60 * 60, JSON.stringify(videoMetadata));

      // Update final progress
      const finalProgress = uploadProgress.get(uploadId) || { received: 0, total: 0, progress: 0 };
      uploadProgress.set(uploadId, {
        received: finalProgress.received || 0,
        total: finalProgress.total || 0,
        progress: finalProgress.progress || 0,
        processingProgress: 0,
        processingTotal: 1,
        phase: 'processing',
        timestamp: Date.now(),
        jobId: videoJobId
      });

      console.log(`✅ Video processing job ${videoJobId} submitted: ${fileName}`);

      const downloadUrl = `${process.env.DOWNLOAD_BASE_URL || "http://localhost:3000"}/download/${fileId}`;

      return res.json({
        success: true,
        fileId,
        fileName,
        downloadUrl,
        uploadId,
        jobId: videoJobId,
        isVideo: true,
        hash: mainMedia.hash,
        message: "Video processing job submitted successfully",
        features: {
          progressTracking: true,
          fileIntegrityCheck: true,
          streamingUpload: true,
          videoProcessing: true,
          backgroundProcessing: true
        }
      });
    } else {
      // Process image (existing logic)
      const originalFormat = mainMedia.mimetype.split("/")[1].toLowerCase();
      const fileExtension = originalFormat === "jpeg" ? "jpg" : originalFormat;

      // Process image with streaming
      const imageBuffer = fs.readFileSync(mainMedia.filepath);
      processedBuffer = await addLogoToImage(
        imageBuffer,
        logoPath,
        originalFormat,
        {
          logoSize,
          logoOpacity,
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        }
      );

      // Generate file info
      fileName = `processed_${Date.now()}_${mainMedia.originalFilename?.replace(/\.[^/.]+$/, "") || 'image'}.${fileExtension}`;
      filePath = path.join(mediaDir, fileName);

      // Save processed image
      fs.writeFileSync(filePath, processedBuffer);
    }

    // For images, continue with immediate processing
    if (!isVideo) {
      // Cleanup temp files
      try {
        fs.unlinkSync(mainMedia.filepath);
        if (customLogo && logoType === "custom") {
          fs.unlinkSync(customLogo.filepath);
        }
      } catch (err) {
        console.warn("Failed to cleanup temp files:", err.message);
      }

      // Store metadata in Redis
      const fileMetadata = {
        fileId,
        fileName,
        originalFileName: mainMedia.originalFilename,
        filePath,
        mimeType: mainMedia.mimetype,
        size: processedBuffer.length,
        uploadedAt: new Date().toISOString(),
        processedWith: logoType === "custom" ? "custom-logo" : "28news-logo",
        hash: mainMedia.hash,
        isVideo: false,
        logoOptions: {
          logoType,
          logoSize,
          logoOpacity,
          paddingXPercent,
          paddingYPercent,
          logoPosition,
        },
      };

      await redis.setEx(`file:${fileId}`, 4 * 60 * 60, JSON.stringify(fileMetadata));

      // Update final progress - maintain upload progress data
      const finalProgress = uploadProgress.get(uploadId) || { received: 0, total: 0, progress: 0 };
      uploadProgress.set(uploadId, {
        received: finalProgress.received || 0,
        total: finalProgress.total || 0,
        progress: finalProgress.progress || 0,
        processingProgress: 100,
        processingTotal: 1,
        phase: 'completed',
        timestamp: Date.now()
      });

      console.log(`✅ Image processed and saved: ${fileName}`);

      const downloadUrl = `${process.env.DOWNLOAD_BASE_URL || "http://localhost:3000"}/download/${fileId}`;

      return res.json({
        success: true,
        fileId,
        fileName,
        downloadUrl,
        uploadId,
        isVideo: false,
        size: processedBuffer.length,
        hash: mainMedia.hash,
        message: "Image processed successfully with logo",
        features: {
          progressTracking: true,
          fileIntegrityCheck: true,
          streamingUpload: true,
          instantProcessing: true
        }
      });
    }

  } catch (error) {
    console.error("Upload error:", error);
    
    // Cleanup on error
    if (form && form.openedFiles) {
      form.openedFiles.forEach(file => {
        try {
          fs.unlinkSync(file.filepath);
        } catch (e) {
          console.warn(`Failed to cleanup file: ${file.filepath}`);
        }
      });
    }

    res.status(500).json({
      error: "Failed to process image",
      message: error.message,
      uploadId
    });
  }
});

// Legacy single image upload endpoint (backward compatibility)
app.post("/upload-image", async (req, res) => {
  // Redirect to the new unified endpoint
  req.url = "/upload-media";
  return app._router.handle(req, res);
});

// Optimized download endpoint with range support and caching
app.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const range = req.headers.range;

    console.log(`Download request for file: ${fileId}${range ? ` (Range: ${range})` : ''}`);

    // Get file metadata from Redis
    const fileMetadataStr = await redis.get(`file:${fileId}`);

    if (!fileMetadataStr) {
      console.log(`File not found or expired: ${fileId}`);
      return res.status(404).json({
        error: "File not found or expired",
        message: "The requested file may have been deleted or the download link has expired.",
      });
    }

    const fileMetadata = JSON.parse(fileMetadataStr);

    // Check if file exists on disk
    if (!fs.existsSync(fileMetadata.filePath)) {
      console.log(`File not found on disk: ${fileMetadata.filePath}`);
      return res.status(404).json({
        error: "File not found on disk",
        message: "The file has been removed from the server.",
      });
    }

    const stats = fs.statSync(fileMetadata.filePath);
    const fileSize = stats.size;
    const fileName = fileMetadata.fileName || fileMetadata.originalFileName || `file_${fileId}`;
    const mimeType = fileMetadata.mimeType || "application/octet-stream";

    // Set common headers
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    res.setHeader("ETag", `"${fileMetadata.hash || stats.mtime.getTime()}"`);
    res.setHeader("Last-Modified", stats.mtime.toUTCString());

    // Handle range requests for resumable downloads
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
        return res.end();
      }

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", chunkSize);

      console.log(`Serving range: ${start}-${end}/${fileSize} for ${fileName}`);

      // Stream the requested range
      const fileStream = createReadStream(fileMetadata.filePath, { start, end });
      
      fileStream.on("error", (error) => {
        console.error("Error streaming file range:", error);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      await pipeline(fileStream, res);
    } else {
      // Full file download
      res.setHeader("Content-Length", fileSize);
      
      console.log(`Serving full file: ${fileName} (${fileSize} bytes)`);

      const fileStream = createReadStream(fileMetadata.filePath);
      
      fileStream.on("error", (error) => {
        console.error("Error streaming file:", error);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

      await pipeline(fileStream, res);
    }

    console.log(`✅ Successfully served: ${fileName}`);

  } catch (error) {
    console.error("Download error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message: "An error occurred while processing your download request.",
      });
    }
  }
});

// Chunked upload endpoint for large files
app.post("/upload-chunk/:uploadId/:chunkIndex", async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.params;
    const chunkDir = path.join(process.cwd(), "chunks", uploadId);
    
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const form = createFormidableForm({
      uploadDir: chunkDir,
      filename: () => `chunk_${chunkIndex}`,
      maxFileSize: 200 * 1024 * 1024, // 200MB per chunk
    });

    const [fields, files] = await form.parse(req);
    const chunkFile = Object.values(files)[0];
    
    if (!chunkFile) {
      return res.status(400).json({ error: "No chunk data received" });
    }

    // Store chunk metadata
    const chunkInfo = {
      index: parseInt(chunkIndex),
      size: chunkFile.size,
      hash: chunkFile.hash,
      path: chunkFile.filepath,
      received: Date.now()
    };

    await redis.setEx(`chunk:${uploadId}:${chunkIndex}`, 3600, JSON.stringify(chunkInfo));

    // Check if this is the final chunk
    const totalChunks = parseInt(fields.totalChunks?.[0] || "1");
    const fileName = fields.fileName?.[0] || "unknown";
    
    if (parseInt(chunkIndex) === totalChunks - 1) {
      // All chunks received, merge them
      const mergedFilePath = await mergeChunks(uploadId, totalChunks, fileName);
      
      // Cleanup chunk directory
      fs.rmSync(chunkDir, { recursive: true, force: true });
      
      return res.json({
        success: true,
        status: "complete",
        uploadId,
        filePath: mergedFilePath,
        message: "File upload completed"
      });
    }

    res.json({
      success: true,
      status: "chunk_received",
      uploadId,
      chunkIndex: parseInt(chunkIndex),
      totalChunks
    });

  } catch (error) {
    console.error("Chunk upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Merge chunks helper function
async function mergeChunks(uploadId, totalChunks, fileName) {
  const outputPath = path.join(process.cwd(), "temp_uploads", `merged_${uploadId}_${fileName}`);
  const writeStream = createWriteStream(outputPath);
  
  for (let i = 0; i < totalChunks; i++) {
    const chunkInfoStr = await redis.get(`chunk:${uploadId}:${i}`);
    if (!chunkInfoStr) {
      throw new Error(`Missing chunk ${i}`);
    }
    
    const chunkInfo = JSON.parse(chunkInfoStr);
    const readStream = createReadStream(chunkInfo.path);
    
    await pipeline(readStream, writeStream, { end: false });
    
    // Cleanup chunk metadata
    await redis.del(`chunk:${uploadId}:${i}`);
  }
  
  writeStream.end();
  return outputPath;
}

// Upload progress endpoint
app.get("/upload-progress/:uploadId", async (req, res) => {
  const { uploadId } = req.params;
  let progress = uploadProgress.get(uploadId);
  
  if (!progress) {
    return res.status(404).json({ error: "Upload not found" });
  }
  
  // If the progress is in processing phase and we have a jobId, check job status directly
  if (progress.phase === 'processing' && progress.jobId) {
    try {
      // Get job status directly using the stored jobId (much faster)
      const jobStatus = await getJobStatus(progress.jobId);
      if (jobStatus) {
        updateUploadProgressFromJob(uploadId, jobStatus);
        progress = uploadProgress.get(uploadId);
      }
    } catch (error) {
      console.error(`Error checking job status for upload ${uploadId}:`, error);
    }
  }
  
  res.json(progress);
});

// Bulk progress endpoint for multiple uploads
app.post("/bulk-progress", async (req, res) => {
  try {
    const { uploadIds } = req.body;
    
    if (!Array.isArray(uploadIds)) {
      return res.status(400).json({ error: "uploadIds must be an array" });
    }

    const progressData = {};
    const jobStatusPromises = [];
    
    // First collect all progress data and prepare job status promises
    uploadIds.forEach(uploadId => {
      const progress = uploadProgress.get(uploadId);
      if (progress) {
        progressData[uploadId] = progress;
        
        // If in processing phase and has jobId, prepare to update from job
        if (progress.phase === 'processing' && progress.jobId) {
          jobStatusPromises.push({
            uploadId,
            promise: getJobStatus(progress.jobId)
          });
        }
      }
    });
    
    // If we have any job status promises, resolve them in parallel
    if (jobStatusPromises.length > 0) {
      const jobResults = await Promise.allSettled(jobStatusPromises.map(item => item.promise));
      
      // Update progress data with job results
      jobResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const uploadId = jobStatusPromises[index].uploadId;
          updateUploadProgressFromJob(uploadId, result.value);
          progressData[uploadId] = uploadProgress.get(uploadId);
        }
      });
    }

    res.json(progressData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static files from processed directory
app.use("/processed", express.static(processedDir));

// Serve test files from root directory
app.get("/test-progress.html", (req, res) => {
  res.sendFile(path.join(process.cwd(), "test-progress.html"));
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "download-server",
  });
});

// File info endpoint (optional - for debugging)
app.get("/info/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileMetadataStr = await redis.get(`file:${fileId}`);

    if (!fileMetadataStr) {
      return res.status(404).json({ error: "File not found" });
    }

    const fileMetadata = JSON.parse(fileMetadataStr);

    // Remove sensitive file path from response
    const safeMetadata = {
      ...fileMetadata,
      filePath: "[HIDDEN]",
      fileExists: fs.existsSync(fileMetadata.filePath),
    };

    res.json(safeMetadata);
  } catch (error) {
    console.error("Info error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Download server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Download endpoint: http://localhost:${port}/download/{fileId}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down download server...");
  await redis.disconnect();
  process.exit(0);
});
