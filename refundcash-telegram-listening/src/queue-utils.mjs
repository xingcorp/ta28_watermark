import { Queue } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";
dotenv.config();

// Redis connection configuration
console.log(process.env.REDIS_URL);
const redisConnection = {
  url: process.env.REDIS_URL,
};

// Get environment suffix for queue names
const envSuffix = process.env.NODE_ENV ? `-${process.env.NODE_ENV}` : '-development';

// Initialize BullMQ queue for image processing
export const imageQueue = new Queue(`image-processing${envSuffix}`, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

// Initialize BullMQ queue for video processing
export const videoQueue = new Queue(`video-processing${envSuffix}`, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 5,
    removeOnFail: 20,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

// Helper function to convert image buffers to base64 for Redis storage
export function prepareImagesForQueue(images) {
  return images.map((image) => ({
    ...image,
    buffer: Buffer.isBuffer(image.buffer)
      ? image.buffer.toString("base64")
      : image.buffer,
  }));
}

// Helper function to prepare videos for queue (similar to images but for video files)
export function prepareVideosForQueue(videos) {
  return videos.map((video) => ({
    ...video,
    buffer: Buffer.isBuffer(video.buffer)
      ? video.buffer.toString("base64")
      : video.buffer,
  }));
}

// Helper function to add image processing job to queue
export async function addImageProcessingJob(jobData) {
  try {
    const jobId = jobData.jobId || `job-${uuidv4()}`;

    // Prepare images for queue (convert buffers to base64)
    const preparedImages = prepareImagesForQueue(jobData.images);

    // Add job to BullMQ
    const bullJob = await imageQueue.add(
      "process-images",
      {
        jobId,
        images: preparedImages,
        logoPath: jobData.logoPath,
        options: jobData.options || {},
        customLogoPath: jobData.customLogoPath,
        generateThumbnail: jobData.generateThumbnail !== false, // Default true for backward compatibility
        source: jobData.source || "unknown", // Track where job came from
        totalImages: preparedImages.length, // Add totalImages to job data
      },
      {
        jobId, // Use our jobId as BullMQ job ID
        priority: jobData.priority || 1,
      }
    );

    console.log(`Job ${jobId} added to BullMQ queue from ${jobData.source}`);
    return { jobId, bullJob };
  } catch (error) {
    console.error(`Error adding job to queue:`, error);
    throw error;
  }
}

// Helper function to add video processing job to queue
export async function addVideoProcessingJob(jobData) {
  try {
    const jobId = jobData.jobId || `video-job-${uuidv4()}`;

    // Prepare videos for queue (convert buffers to base64)
    const preparedVideos = prepareVideosForQueue(jobData.videos);

    // Add job to BullMQ video queue
    const bullJob = await videoQueue.add(
      "process-videos",
      {
        jobId,
        videos: preparedVideos,
        logoPath: jobData.logoPath,
        options: jobData.options || {},
        customLogoPath: jobData.customLogoPath,
        generateThumbnail: jobData.generateThumbnail !== false,
        source: jobData.source || "unknown",
        totalVideos: preparedVideos.length,
      },
      {
        jobId,
        priority: jobData.priority || 1,
      }
    );

    console.log(`Video job ${jobId} added to BullMQ queue from ${jobData.source}`);
    return { jobId, bullJob };
  } catch (error) {
    console.error(`Error adding video job to queue:`, error);
    throw error;
  }
}

// Helper function to get job status from BullMQ (supports both image and video jobs)
export async function getJobStatus(jobId) {
  try {
    // First try image queue
    let job = await imageQueue.getJob(jobId);
    let isVideoJob = false;
    
    // If not found in image queue, try video queue
    if (!job) {
      job = await videoQueue.getJob(jobId);
      isVideoJob = true;
    }
    
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress || 0;

    return {
      jobId: job.id,
      status: state,
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      timestamp: job.timestamp,
      isVideoJob,
    };
  } catch (error) {
    console.error(`Error getting job status for ${jobId}:`, error);
    return null;
  }
}

// Helper function to cancel job (supports both image and video jobs)
export async function cancelJob(jobId) {
  try {
    // Try image queue first
    let job = await imageQueue.getJob(jobId);
    
    // If not found, try video queue
    if (!job) {
      job = await videoQueue.getJob(jobId);
    }
    
    if (!job) {
      return false;
    }

    const state = await job.getState();
    if (["completed", "failed"].includes(state)) {
      return false; // Cannot cancel completed/failed jobs
    }

    await job.remove();
    return true;
  } catch (error) {
    console.error(`Error cancelling job ${jobId}:`, error);
    return false;
  }
}

// Helper function to get queue statistics (both image and video queues)
export async function getQueueStats() {
  try {
    // Image queue stats
    const imageWaiting = await imageQueue.getWaiting();
    const imageActive = await imageQueue.getActive();
    const imageCompleted = await imageQueue.getCompleted();
    const imageFailed = await imageQueue.getFailed();

    // Video queue stats
    const videoWaiting = await videoQueue.getWaiting();
    const videoActive = await videoQueue.getActive();
    const videoCompleted = await videoQueue.getCompleted();
    const videoFailed = await videoQueue.getFailed();

    return {
      images: {
        queuedJobs: imageWaiting.length,
        processingJobs: imageActive.length,
        completedJobs: imageCompleted.length,
        failedJobs: imageFailed.length,
        maxConcurrentJobs: 1, // From image worker concurrency
      },
      videos: {
        queuedJobs: videoWaiting.length,
        processingJobs: videoActive.length,
        completedJobs: videoCompleted.length,
        failedJobs: videoFailed.length,
        maxConcurrentJobs: 1, // From video worker concurrency
      },
      total: {
        queuedJobs: imageWaiting.length + videoWaiting.length,
        processingJobs: imageActive.length + videoActive.length,
        completedJobs: imageCompleted.length + videoCompleted.length,
        failedJobs: imageFailed.length + videoFailed.length,
      }
    };
  } catch (error) {
    console.error("Error getting queue stats:", error);
    throw error;
  }
}

export default {
  imageQueue,
  videoQueue,
  addImageProcessingJob,
  addVideoProcessingJob,
  getJobStatus,
  cancelJob,
  getQueueStats,
  prepareImagesForQueue,
  prepareVideosForQueue,
};
