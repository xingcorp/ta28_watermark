export interface UploadImageRequest {
  image: File;
  logoFile?: File;
  logoPosition: string;
  logoSize: number;
  logoOpacity: number;
  paddingXPercent: number; // Percentage value (0-20%) - responsive padding based on image width
  paddingYPercent: number; // Percentage value (0-20%) - responsive padding based on image height
}

export interface BatchJobRequest {
  mediaFiles: File[]; // Images and videos
  logoFile?: File;
  logoPosition: string;
  logoSize: number;
  logoOpacity: number;
  paddingXPercent: number; // Percentage value (0-20%) - responsive padding based on image width
  paddingYPercent: number; // Percentage value (0-20%) - responsive padding based on image height
}

export interface UploadImageResponse {
  success: boolean;
  processedImageUrl?: string;
  error?: string;
}

export interface JobResponse {
  success: boolean;
  jobId: string;
  message?: string;
  error?: string;
}

export interface JobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  totalImages: number;
  completedImages: number;
  processedImages: ProcessedImageResult[];
  error?: string;
}

export interface ProcessedImageResult {
  originalName: string;
  processedImageUrl: string; // For backward compatibility
  thumbnailUrl?: string; // Compressed thumbnail for preview
  fullImageUrl?: string; // Full-size image for download
  processedVideoUrl?: string; // For video results
  fullVideoUrl?: string; // Full-size video for download
  status: "completed" | "failed";
  error?: string;
}

export interface EnhancedJobResponse extends JobResponse {
  totalImages?: number;
  completedImages?: number;
  processedImages?: ProcessedImageResult[];
  progress?: number;
}

export interface ProgressCallback {
  type: "upload" | "processing";
  progress: number;
  uploadedBytes?: number;
  totalBytes?: number;
  speed?: number; // bytes per second
  eta?: number; // estimated time remaining in seconds
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

export class ImageUploadService {
  private static convertToAbsoluteUrl(url: string): string {
    if (!url) return url;

    // If it's already an absolute URL, return as is
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }

    // If it starts with /, it's a relative URL from the API server
    if (url.startsWith("/")) {
      return `${API_BASE_URL}${url}`;
    }

    // Otherwise, assume it's a relative path and prepend the API base URL
    return `${API_BASE_URL}/${url}`;
  }

  static async submitBatchJob(
    mediaFiles: File[],
    logoFile: File | null,
    logoPosition: string,
    logoSize: number,
    logoOpacity: number,
    paddingXPercent: number,
    paddingYPercent: number,
    onProgress?: (progress: ProgressCallback) => void
  ): Promise<EnhancedJobResponse> {
    try {
      // Validate file sizes (2GB limit per file)
      const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
      const oversizedFiles = mediaFiles.filter(
        (file) => file.size > MAX_FILE_SIZE
      );

      if (oversizedFiles.length > 0) {
        throw new Error(
          `Files exceed 2GB limit: ${oversizedFiles
            .map((f) => f.name)
            .join(", ")}`
        );
      }

      // Validate file types - accept both images and videos
      const invalidFiles = mediaFiles.filter(
        (file) =>
          !file.type.startsWith("image/") && !file.type.startsWith("video/")
      );

      if (invalidFiles.length > 0) {
        throw new Error(
          `Invalid file types. Only images and videos are supported: ${invalidFiles
            .map((f) => f.name)
            .join(", ")}`
        );
      }

      // Validate batch size (10GB total limit for 2GB files)
      const totalSize = mediaFiles.reduce((sum, file) => sum + file.size, 0);
      const MAX_BATCH_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

      if (totalSize > MAX_BATCH_SIZE) {
        throw new Error(
          `Total batch size exceeds 10GB limit. Current size: ${(
            totalSize /
            1024 /
            1024 /
            1024
          ).toFixed(2)}GB`
        );
      }

      // Validate file count (20 files maximum)
      if (mediaFiles.length > 20) {
        throw new Error(
          `Too many files. Maximum 20 files per batch. Current: ${mediaFiles.length}`
        );
      }

      const formData = new FormData();

      // Add all media files with proper naming - use 'files' to match backend expectation
      mediaFiles.forEach((mediaFile) => {
        formData.append("files", mediaFile, mediaFile.name);
      });

      // Add logo file if provided
      if (logoFile) {
        formData.append("logo", logoFile, logoFile.name);
      }

      // Add other parameters
      formData.append("logoPosition", logoPosition);
      formData.append("logoSize", logoSize.toString());
      formData.append("logoOpacity", logoOpacity.toString());
      formData.append("paddingXPercent", paddingXPercent.toString());
      formData.append("paddingYPercent", paddingYPercent.toString());

      if (process.env.NODE_ENV === 'development') {
        console.log('Submitting batch job with files:', mediaFiles.map(f => f.name));
      }
      if (process.env.NODE_ENV === 'development') {
        console.log("Media files count:", mediaFiles.length);
        console.log("Total size:", (totalSize / 1024 / 1024).toFixed(2), "MB");
        console.log("Logo file:", logoFile ? logoFile.name : "None");
      }

      // Track upload progress
      const startTime = Date.now();

      if (onProgress) {
        onProgress({
          type: "upload",
          progress: 0,
          uploadedBytes: 0,
          totalBytes: totalSize,
          speed: 0,
          eta: 0,
        });
      }

      const response = await fetch("/api/submit-batch-job", {
        method: "POST",
        body: formData,
        // Increased timeout for large files
        signal: AbortSignal.timeout(300000), // 5 minutes
      });

      if (onProgress) {
        onProgress({
          type: "upload",
          progress: 100,
          uploadedBytes: totalSize,
          totalBytes: totalSize,
          speed: totalSize / ((Date.now() - startTime) / 1000),
          eta: 0,
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "Batch job submission failed:",
          response.status,
          errorText
        );
        throw new Error(
          `Upload failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      if (process.env.NODE_ENV === 'development') {
        console.log('Batch job submitted successfully:', result);
      }

      return {
        success: result.success,
        jobId: result.jobId || result.job_id,
        message: result.message,
        error: result.error,
        totalImages: mediaFiles.length,
        completedImages: 0,
        processedImages: [],
        progress: 0,
      };
    } catch (error: unknown) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error submitting batch job:', error);
      }
      throw error;
    }
  }

  static async getJobStatus(jobId: string, retryCount = 0): Promise<JobStatus> {
    const maxRetries = 3;
    const retryDelays = [1000, 2000, 4000]; // 1s, 2s, 4s

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Polling job status for: ${jobId}`);
      }
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `Getting job status for ${jobId} (attempt ${retryCount + 1})`
        );
      }

      const response = await fetch(`/api/job-status/${jobId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        // Add timeout for status requests
        signal: AbortSignal.timeout(30000), // 30 seconds
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (process.env.NODE_ENV === 'development') {
        console.log(`Job ${jobId} status:`, result.status, `Progress: ${result.progress}%`);
      }

      // Enhanced field mapping for mixed image/video content
      const hasVideoFields =
        result.totalVideos !== undefined ||
        result.completedVideos !== undefined ||
        result.processedVideos !== undefined;

      const hasImageFields =
        result.totalImages !== undefined ||
        result.completedImages !== undefined ||
        result.processedImages !== undefined;

      console.log("Media fields detected:", {
        hasVideoFields,
        hasImageFields,
        totalVideos: result.totalVideos,
        completedVideos: result.completedVideos,
        processedVideos: result.processedVideos?.length,
        totalImages: result.totalImages,
        completedImages: result.completedImages,
        processedImages: result.processedImages?.length,
      });

      if (process.env.NODE_ENV === 'development') {
        console.log(`Job ${jobId} completed with ${result.processedImages?.length || 0} processed images`);
      }

      // Handle mixed content or video-only content
      if (hasVideoFields && !hasImageFields) {
        if (process.env.NODE_ENV === 'development') {
          console.log("Video-only content detected, mapping to image fields");
        }
        result.totalImages = result.totalVideos || 0;
        result.completedImages = result.completedVideos || 0;
        result.processedImages = result.processedVideos || [];
      } else if (hasVideoFields && hasImageFields) {
        if (process.env.NODE_ENV === 'development') {
          console.log("Mixed image/video content detected, combining fields");
        }
        // Combine totals for mixed content
        result.totalImages =
          (result.totalImages || 0) + (result.totalVideos || 0);
        result.completedImages =
          (result.completedImages || 0) + (result.completedVideos || 0);

        // Combine processed arrays
        const combinedProcessed = [
          ...(result.processedImages || []),
          ...(result.processedVideos || []),
        ];
        result.processedImages = combinedProcessed;
      }

      // Convert relative URLs to absolute URLs
      if (result.processedImages && Array.isArray(result.processedImages)) {
        result.processedImages = result.processedImages.map((img: unknown) => {
          const imgData = img as Record<string, unknown>;
          return {
            ...imgData,
            processedImageUrl: typeof imgData.processedImageUrl === 'string'
              ? this.convertToAbsoluteUrl(imgData.processedImageUrl)
              : imgData.processedImageUrl,
            thumbnailUrl: typeof imgData.thumbnailUrl === 'string'
              ? this.convertToAbsoluteUrl(imgData.thumbnailUrl)
              : imgData.thumbnailUrl,
            fullImageUrl: typeof imgData.fullImageUrl === 'string'
              ? this.convertToAbsoluteUrl(imgData.fullImageUrl)
              : imgData.fullImageUrl,
            processedVideoUrl: typeof imgData.processedVideoUrl === 'string'
              ? this.convertToAbsoluteUrl(imgData.processedVideoUrl)
              : imgData.processedVideoUrl,
            fullVideoUrl: typeof imgData.fullVideoUrl === 'string'
              ? this.convertToAbsoluteUrl(imgData.fullVideoUrl)
              : imgData.fullVideoUrl,
          };
        });
      }

      return {
        jobId: result.jobId || result.job_id || jobId,
        status: result.status || "pending",
        progress: result.progress || 0,
        totalImages: result.totalImages || 0,
        completedImages: result.completedImages || 0,
        processedImages: result.processedImages || [],
        error: result.error,
      };
    } catch (error: unknown) {
      console.error(
        `Error getting job status (attempt ${retryCount + 1}):`,
        error
      );

      if (retryCount < maxRetries) {
        const delay = Math.min(retryDelays[retryCount] || 5000, 5000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.getJobStatus(jobId, retryCount + 1);
      }

      throw error;
    }
  }

  static async pollJobStatus(
    jobId: string,
    onUpdate?: (status: JobStatus) => void,
    onComplete?: (finalStatus: JobStatus) => void,
    onError?: (error: string) => void,
    pollInterval: number = 5000, // Increased from 2s to 5s
    maxConsecutiveFailures: number = 5
  ): Promise<void> {
    let consecutiveFailures = 0;
    let currentInterval = pollInterval;

    const poll = async (): Promise<void> => {
      try {
        const status = await this.getJobStatus(jobId);

        // Reset failure count and interval on successful poll
        consecutiveFailures = 0;
        currentInterval = pollInterval;

        if (onUpdate) {
          onUpdate(status);
        }

        if (status.status === "completed" || status.status === "failed") {
          if (onComplete) {
            onComplete(status);
          }
          return;
        }

        // Continue polling
        setTimeout(poll, currentInterval);
      } catch (error: unknown) {
        consecutiveFailures++;
        if (process.env.NODE_ENV === 'development') {
          console.error('Polling error:', error);
        }
        if (process.env.NODE_ENV === 'development') {
          console.error(
            `Polling error (${consecutiveFailures}/${maxConsecutiveFailures}):`,
            error
          );
        }

        if (consecutiveFailures >= maxConsecutiveFailures) {
          if (onError) {
            onError(
              `Polling failed after ${maxConsecutiveFailures} consecutive attempts`
            );
          }
          if (process.env.NODE_ENV === 'development') {
            console.log(`Polling stopped after ${consecutiveFailures} consecutive failures`);
          }
          return;
        }

        // Exponential backoff for polling interval
        currentInterval = Math.min(currentInterval * 1.5, 30000); // Cap at 30s
        if (process.env.NODE_ENV === 'development') {
          console.log(`Polling interval adjusted to ${currentInterval}ms due to failures`);
        }
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `Retrying in ${currentInterval}ms with exponential backoff...`
          );
        }

        setTimeout(poll, currentInterval);
      }
    };

    // Start polling
    poll();
  }
}
