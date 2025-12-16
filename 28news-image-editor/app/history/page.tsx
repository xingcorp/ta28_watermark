"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  History,
  ArrowLeft,
  Trash2,
  RefreshCw,
  Loader2,
  Video,
  Image as ImageIcon,
} from "lucide-react";
import { JobStorage, StoredJob } from "@/lib/storage";
import { ImageUploadService } from "@/lib/api";
import Link from "next/link";

export default function JobHistoryPage() {
  // Helper function to check if a file is a video
  const isVideoFile = (filename: string): boolean => {
    const videoExtensions = [
      ".mp4",
      ".avi",
      ".mov",
      ".wmv",
      ".flv",
      ".webm",
      ".mkv",
      ".m4v",
      ".3gp",
    ];
    const ext = filename.toLowerCase().split(".").pop();
    return ext ? videoExtensions.includes(`.${ext}`) : false;
  };
  const [storedJobs, setStoredJobs] = useState<StoredJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadingJobs, setDownloadingJobs] = useState<Set<string>>(
    new Set()
  );
  // Use useRef instead of useState for the interval to avoid re-renders
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Main function to load jobs without handling polling
  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    const jobs = JobStorage.getStoredJobs();
    console.log("Loaded jobs:", jobs);

    // Debug: Log detailed job data
    jobs.forEach((job, index) => {
      console.log(`Job ${index + 1} (${job.jobId}):`, {
        status: job.jobData.status,
        totalImages: job.jobData.totalImages,
        completedImages: job.jobData.completedImages,
        processedImagesCount: job.jobData.processedImages?.length || 0,
        processedImages: job.jobData.processedImages,
        originalFileNames: job.originalFileNames,
      });
    });

    setStoredJobs(jobs);
    setIsLoading(false);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);

    // Clear polling interval during refresh to prevent conflicts
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Test specific job ID and update storage
    const testJobId = "job-2b0e3dfa-6f8b-456b-ab96-e83bffb03b44";
    console.log(`Testing specific job: ${testJobId}`);
    try {
      const testStatus = await ImageUploadService.getJobStatus(testJobId);
      console.log("Test job status result:", testStatus);

      // Force update the job in storage with the latest data
      if (testStatus) {
        console.log("Force updating job in storage with latest data");
        JobStorage.updateJob(testJobId, testStatus);
      }
    } catch (error) {
      console.error("Error testing specific job:", error);
    }

    await loadJobs();
    // Add a small delay to show the animation
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Initial load effect - runs once
  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate effect for managing polling - only runs when storedJobs changes
  useEffect(() => {
    console.log("Setting up polling effect");
    // Clear any existing interval first
    if (pollingIntervalRef.current) {
      console.log("Clearing existing polling interval");
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Check if we need to poll any jobs
    const hasJobsToUpdate = storedJobs.some(
      (job) =>
        job.jobData &&
        (job.jobData.status === "pending" ||
          job.jobData.status === "processing")
    );

    // Set up new interval if needed
    if (hasJobsToUpdate) {
      console.log(
        "Setting up 5-second polling interval for non-completed jobs"
      );

      const pollJobs = async () => {
        console.log("Polling non-completed jobs...");
        const currentJobs = JobStorage.getStoredJobs();
        const jobsToUpdate = currentJobs.filter(
          (job) =>
            job.jobData &&
            (job.jobData.status === "pending" ||
              job.jobData.status === "processing")
        );

        if (jobsToUpdate.length === 0) {
          console.log("No jobs need polling, clearing interval");
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        }

        let hasUpdates = false;
        const updatedJobs = [...storedJobs];

        // Update each job that needs polling
        for (const job of jobsToUpdate) {
          try {
            const status = await ImageUploadService.getJobStatus(job.jobId);
            if (status) {
              // Update in local storage
              JobStorage.updateJob(job.jobId, status);

              // Update our local copy of jobs
              const jobIndex = updatedJobs.findIndex(
                (j) => j.jobId === job.jobId
              );
              if (jobIndex !== -1) {
                // Check if status has actually changed
                const oldJob = updatedJobs[jobIndex];

                // Deep comparison of processed images to detect any changes
                let hasImageChanges = false;
                if (
                  oldJob.jobData.processedImages.length !==
                  status.processedImages.length
                ) {
                  hasImageChanges = true;
                } else {
                  // Check if any image properties have changed
                  for (let i = 0; i < status.processedImages.length; i++) {
                    const newImg = status.processedImages[i];
                    const oldImg = oldJob.jobData.processedImages[i];

                    if (
                      oldImg &&
                      (oldImg.status !== newImg.status ||
                        oldImg.thumbnailUrl !== newImg.thumbnailUrl ||
                        oldImg.fullImageUrl !== newImg.fullImageUrl ||
                        oldImg.processedImageUrl !== newImg.processedImageUrl ||
                        oldImg.processedVideoUrl !== newImg.processedVideoUrl ||
                        oldImg.fullVideoUrl !== newImg.fullVideoUrl)
                    ) {
                      hasImageChanges = true;
                      break;
                    }
                  }
                }

                const hasStatusChange =
                  oldJob.jobData.status !== status.status ||
                  oldJob.jobData.progress !== status.progress ||
                  oldJob.jobData.completedImages !== status.completedImages ||
                  hasImageChanges;

                if (hasStatusChange) {
                  console.log(`Job ${job.jobId} has updates, refreshing UI`);
                  updatedJobs[jobIndex] = { ...oldJob, jobData: status };
                  hasUpdates = true;
                }
              }
            }
          } catch (error) {
            console.error(`Error polling job ${job.jobId}:`, error);
          }
        }

        // Only update state if we have actual changes
        if (hasUpdates) {
          console.log("Updating UI with new job data", updatedJobs);
          // Create a new array to ensure React detects the change
          setStoredJobs([...updatedJobs]);
        } else {
          console.log("No updates detected in polling");

          // Force a UI refresh every 5 polling cycles even if no changes detected
          // This ensures the UI stays in sync with localStorage
          const currentTime = Date.now();
          const lastForceUpdateTime =
            window.sessionStorage.getItem("lastForceUpdateTime") || "0";
          const timeSinceLastForce =
            currentTime - parseInt(lastForceUpdateTime, 10);

          if (timeSinceLastForce > 30000) {
            // 30 seconds (roughly 5 polling cycles)
            console.log("Force refreshing UI to ensure sync with localStorage");
            window.sessionStorage.setItem(
              "lastForceUpdateTime",
              currentTime.toString()
            );
            // Load fresh from storage and force update
            const freshJobs = JobStorage.getStoredJobs();
            setStoredJobs([...freshJobs]);
          }
        }
      };

      // Poll immediately, then set up interval
      pollJobs();
      pollingIntervalRef.current = setInterval(pollJobs, 6666);
    }

    // Cleanup function
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [storedJobs]); // Include storedJobs in the dependency array

  const downloadImage = async (imageUrl: string) => {
    try {
      if (!imageUrl) {
        if (process.env.NODE_ENV === 'development') {
          console.error("No image URL provided for download");
        }
        return;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log("Downloading media from URL:", imageUrl);
      }

      // Use the proxy API for downloading
      const proxyUrl = `/api/download-image?url=${encodeURIComponent(imageUrl)}`;
      
      // Create an anchor element and trigger download
      const a = document.createElement("a");
      a.href = proxyUrl;
      
      // Extract filename from URL or use a default name
      const urlParts = imageUrl.split("/");
      const downloadFilename = urlParts[urlParts.length - 1].split("?")[0] || "download";
      a.download = downloadFilename;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error("Error downloading media:", error);
      }
      // Fallback to opening in a new tab if download fails
      window.open(imageUrl, "_blank");
    }
  };

  interface ProcessedImage {
    originalName: string;
    processedImageUrl: string; // For backward compatibility
    thumbnailUrl?: string; // New field for compressed thumbnail
    fullImageUrl?: string; // New field for full-size image
    processedVideoUrl?: string; // For video results
    fullVideoUrl?: string; // Full-size video for download
    status: "completed" | "failed" | "pending" | "processing";
    error?: string;
  }

  const downloadAllFromJob = async (
    processedImages: ProcessedImage[],
    jobId: string
  ) => {
    setDownloadingJobs((prev) => new Set(prev).add(jobId));

    // Log the images we're about to process
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `Preparing to download ${processedImages.length} images from job ${jobId}`
      );
    }

    const completedImages = processedImages.filter((img) => {
      if (img.status !== "completed") return false;

      const isVideo = isVideoFile(img.originalName);
      return isVideo
        ? img.fullVideoUrl || img.processedVideoUrl || img.processedImageUrl
        : img.fullImageUrl || img.processedImageUrl;
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`Found ${completedImages.length} completed images with URLs`);
    }

    if (completedImages.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn("No completed images with valid URLs found for download");
      }
      setDownloadingJobs((prev) => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
      return;
    }

    for (let i = 0; i < completedImages.length; i++) {
      const img = completedImages[i];
      const isVideo = isVideoFile(img.originalName);
      const downloadUrl = isVideo
        ? img.fullVideoUrl || img.processedVideoUrl || img.processedImageUrl
        : img.fullImageUrl || img.processedImageUrl;

      if (!downloadUrl) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Missing URL for media: ${img.originalName}`);
        }
        continue;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `Scheduling download for image ${i + 1}/${completedImages.length}: ${
            img.originalName
          }`
        );
      }

      setTimeout(() => downloadImage(downloadUrl), i * 200);
    }

    // Remove downloading state after all downloads are initiated + buffer time
    setTimeout(() => {
      setDownloadingJobs((prev) => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    }, completedImages.length * 200 + 2000);
  };

  const clearAllJobs = () => {
    if (confirm("Are you sure you want to clear all job history?")) {
      JobStorage.clearAllJobs();
      setStoredJobs([]);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    }
    return `${minutes}m ago`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between mb-8 gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Link href="/" className="flex-shrink-0">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Editor
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                <History className="w-8 h-8" />
                Job History
              </h1>
              <p className="text-gray-600 text-lg">
                View and download your processed images from the last 4 hours
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-2 md:mt-0 justify-start md:justify-end">
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="sm"
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            {storedJobs.length > 0 && (
              <Button
                onClick={clearAllJobs}
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>
        </div>

        {/* Jobs List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-gray-400" />
              <p className="text-gray-600">Loading job history...</p>
            </div>
          </div>
        ) : storedJobs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <History className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                No Job History
              </h3>
              <p className="text-gray-500 mb-4">
                You haven&apos;t processed any images yet, or all jobs have
                expired.
              </p>
              <Link href="/">
                <Button>Start Processing Images</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {storedJobs.map((storedJob) => (
              <Card key={storedJob.jobId} className="overflow-hidden">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div className="w-full sm:w-auto">
                      <CardTitle className="text-lg">
                        Job {storedJob.jobId.slice(0, 8)}...
                      </CardTitle>
                      <div className="flex flex-wrap gap-2 sm:gap-4 text-sm text-gray-600 mt-1">
                        <span>
                          {storedJob.jobData.status === "completed"
                            ? "Completed"
                            : "Started"}
                          : {formatDate(storedJob.timestamp)}
                        </span>
                        <span>({getTimeAgo(storedJob.timestamp)})</span>
                        <span>
                          {storedJob.jobData.completedImages}/
                          {storedJob.jobData.totalImages} images
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
                            storedJob.jobData.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : storedJob.jobData.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : storedJob.jobData.status === "processing"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {(storedJob.jobData.status === "processing" ||
                            storedJob.jobData.status === "pending") && (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                          {storedJob.jobData.status}
                          {storedJob.jobData.status === "processing" && (
                            <span className="ml-1">
                              ({Math.round(storedJob.jobData.progress)}%)
                            </span>
                          )}
                        </span>
                        {(storedJob.jobData.status === "processing" ||
                          storedJob.jobData.status === "pending") && (
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                              style={{
                                width: `${storedJob.jobData.progress}%`,
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Download All Button for this job */}
                    {storedJob.jobData.processedImages.some((img) => {
                      if (img.status !== "completed") return false;
                      const isVideo = isVideoFile(img.originalName);
                      return isVideo
                        ? img.fullVideoUrl ||
                            img.processedVideoUrl ||
                            img.processedImageUrl
                        : img.fullImageUrl || img.processedImageUrl;
                    }) && (
                      <Button
                        onClick={() =>
                          downloadAllFromJob(
                            storedJob.jobData.processedImages,
                            storedJob.jobId
                          )
                        }
                        disabled={downloadingJobs.has(storedJob.jobId)}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2 flex-shrink-0 mt-1 sm:mt-0 hover:bg-gray-100 hover:scale-105 transition-all duration-200"
                      >
                        {downloadingJobs.has(storedJob.jobId) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        {downloadingJobs.has(storedJob.jobId)
                          ? "Downloading..."
                          : "Download All"}
                      </Button>
                    )}
                  </div>
                </CardHeader>

                <CardContent>
                  {/* Debug info */}
                  <div className="mb-4 p-2 bg-gray-100 rounded text-xs">
                    <p>
                      <strong>Debug Info:</strong>
                    </p>
                    <p>Job Status: {storedJob.jobData.status}</p>
                    <p>Total Images: {storedJob.jobData.totalImages}</p>
                    <p>Completed Images: {storedJob.jobData.completedImages}</p>
                    <p>
                      Processed Images Array Length:{" "}
                      {storedJob.jobData.processedImages?.length || 0}
                    </p>
                    <p>
                      Original File Names:{" "}
                      {storedJob.originalFileNames?.join(", ") || "None"}
                    </p>
                    <p>
                      <strong>Processed Images Data:</strong>
                    </p>
                    <pre className="text-xs bg-white p-1 rounded mt-1 max-h-32 overflow-y-auto">
                      {JSON.stringify(
                        storedJob.jobData.processedImages,
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  {storedJob.jobData.processedImages &&
                  storedJob.jobData.processedImages.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {storedJob.jobData.processedImages.map((img, index) => (
                        <div
                          key={index}
                          className="border rounded-lg overflow-hidden bg-white"
                        >
                          <div className="relative">
                            {img.status === "completed" &&
                            (img.thumbnailUrl || img.processedImageUrl) ? (
                              <>
                                {/* Check if this is a video by looking for video-specific fields */}
                                {(img.processedVideoUrl || img.fullVideoUrl || 
                                  (img.processedImageUrl && img.processedImageUrl.includes('video')) ||
                                  (img.thumbnailUrl && img.thumbnailUrl.includes('video'))) ? (
                                  <div className="relative">
                                    <video
                                      className="w-full h-48 object-cover rounded-t-lg"
                                      poster={img.thumbnailUrl || img.processedImageUrl}
                                      controls={false}
                                      muted
                                      preload="metadata"
                                    >
                                      <source src={img.processedVideoUrl || img.fullVideoUrl || img.processedImageUrl} type="video/mp4" />
                                      Your browser does not support the video tag.
                                    </video>
                                    {/* Play button overlay */}
                                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded-t-lg">
                                      <div className="bg-white bg-opacity-80 rounded-full p-3">
                                        <svg className="w-8 h-8 text-gray-800" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M8 5v10l8-5-8-5z"/>
                                        </svg>
                                      </div>
                                    </div>
                                    {/* Video indicator badge */}
                                    <div className="absolute top-2 left-2 bg-red-600 text-white px-2 py-1 rounded text-xs font-semibold">
                                      VIDEO
                                    </div>
                                  </div>
                                ) : (
                                  <div className="relative">
                                    <img
                                      src={img.thumbnailUrl || img.processedImageUrl}
                                      alt={`Processed ${img.originalName}`}
                                      className="w-full h-48 object-cover rounded-t-lg"
                                      onError={(e) => {
                                        console.error('Image load error:', e);
                                        e.currentTarget.src = '/placeholder-image.svg';
                                      }}
                                    />
                                    {/* Image indicator badge */}
                                    <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs font-semibold">
                                      IMAGE
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                                {img.status === "failed" ? (
                                  <div className="text-center text-red-500">
                                    <p className="text-sm">Failed</p>
                                  </div>
                                ) : (
                                  <div className="text-center text-gray-500">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                                    <p className="text-sm">Processing</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Status badge */}
                            <div
                              className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium ${
                                img.status === "completed"
                                  ? "bg-green-100 text-green-800"
                                  : img.status === "failed"
                                  ? "bg-red-100 text-red-800"
                                  : img.status === "processing"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {img.status}
                            </div>
                          </div>

                          <div className="p-2">
                            <div className="flex items-center mb-2">
                              <div className="flex-shrink-0 mr-2">
                                {isVideoFile(img.originalName) ? (
                                  <Video className="w-3 h-3 text-blue-500" />
                                ) : (
                                  <ImageIcon className="w-3 h-3 text-green-500" />
                                )}
                              </div>
                              <p className="text-xs font-medium text-gray-700 truncate">
                                {img.originalName}
                              </p>
                            </div>
                            {img.error && (
                              <p className="text-xs text-red-600 mb-2">
                                {img.error}
                              </p>
                            )}
                            <Button
                              onClick={() => {
                                const isVideo = isVideoFile(img.originalName);
                                const downloadUrl = isVideo
                                  ? img.fullVideoUrl ||
                                    img.processedVideoUrl ||
                                    img.processedImageUrl
                                  : img.fullImageUrl || img.processedImageUrl;
                                console.log(
                                  `Downloading ${
                                    isVideo ? "video" : "image"
                                  }: ${downloadUrl}`
                                );
                                downloadImage(downloadUrl);
                              }}
                              size="sm"
                              className="w-full text-xs"
                              variant="outline"
                              disabled={
                                img.status !== "completed" ||
                                !(isVideoFile(img.originalName)
                                  ? img.fullVideoUrl ||
                                    img.processedVideoUrl ||
                                    img.processedImageUrl
                                  : img.fullImageUrl || img.processedImageUrl)
                              }
                            >
                              <Download className="w-3 h-3 mr-1" />
                              Download
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>No processed images available for this job</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
