"use client";

import type React from "react";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Upload,
  Settings,
  X,
  Download,
  Loader2,
  History,
  Video,
  Image as ImageIcon,
} from "lucide-react";
import { ImageUploadService, ProgressCallback } from "@/lib/api";
import { JobStorage } from "@/lib/storage";
import Link from "next/link";
import Image from "next/image";

interface ProcessedImage {
  id: string;
  originalName: string;
  processedDataUrl: string; // For backward compatibility
  thumbnailUrl?: string; // New field for compressed thumbnail
  fullImageUrl?: string; // New field for full-size image
  processedVideoUrl?: string; // For video results
  fullVideoUrl?: string; // Full-size video for download
  downloadUrl: string; // URL used for downloads (should point to full-size image/video)
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

export default function ImageLogoProcessor() {
  const [logoType, setLogoType] = useState<"text" | "image">("image");
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [logoSize, setLogoSize] = useState([15]);
  const [logoOpacity, setLogoOpacity] = useState([80]);
  const [paddingX, setPaddingX] = useState([8]); // Default 5% padding
  const [paddingY, setPaddingY] = useState([8]); // Default 5% padding
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [useDefault28NewsLogo, setUseDefault28NewsLogo] = useState(true);
  const [selectedDefaultLogo, setSelectedDefaultLogo] =
    useState("28news-logo.png");

  // Available default logos
  const defaultLogos = [
    { name: "28NEWS Standard", file: "28news-logo.png" },
    { name: "28NEWS BH", file: "28news-BH.png" },
    { name: "28NEWS TL", file: "28news-TL.png" },
    { name: "28NEWS QK", file: "28news-qk.png" },
  ];
  const [apiError, setApiError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("idle");
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed] = useState<number>(0);
  const [uploadedSize, setUploadedSize] = useState(0);
  const [totalUploadSize, setTotalUploadSize] = useState(0);
  const [uploadPhase] = useState<"uploading" | "processing" | "completed">(
    "uploading"
  );
  const [fileValidationErrors, setFileValidationErrors] = useState<string[]>(
    []
  );
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    // Validate files
    const validationErrors = validateFiles(files);
    setFileValidationErrors(validationErrors);

    if (validationErrors.length === 0) {
      setSelectedFiles(files);
      setApiError(null);
    } else {
      setSelectedFiles([]);
      setApiError(validationErrors.join("; "));
    }
  };

  const validateFiles = (files: File[]): string[] => {
    const errors: string[] = [];
    const MAX_FILE_SIZE = 1600 * 1024 * 1024; // 1.6GB
    const MAX_TOTAL_SIZE = 40 * 1024 * 1024 * 1024; // 40GB total
    const MAX_FILES = 400; // Maximum 400 files per batch

    // Supported file extensions (more reliable than MIME types)
    const supportedImageExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".bmp",
      ".tiff",
      ".tif",
    ];
    const supportedVideoExtensions = [
      ".mp4",
      ".avi",
      ".mov",
      ".wmv",
      ".flv",
      ".webm",
      ".mkv",
      ".m4v",
      ".3gp",
      ".qt",
    ];
    const supportedExtensions = [
      ...supportedImageExtensions,
      ...supportedVideoExtensions,
    ];

    // Helper function to check file extension
    const isValidFileType = (file: File): boolean => {
      // Get file extension
      const extension = "." + file.name.toLowerCase().split(".").pop();

      // Check by extension first (most reliable)
      if (supportedExtensions.includes(extension)) {
        return true;
      }

      // Fallback to MIME type check
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        return true;
      }

      // Special handling for files without MIME type but valid extensions
      if (!file.type || file.type === "application/octet-stream") {
        return supportedExtensions.includes(extension);
      }

      return false;
    };

    // Check file count
    if (files.length > MAX_FILES) {
      errors.push(`Maximum ${MAX_FILES} files allowed per batch`);
    }

    // Check individual file sizes and types
    const oversizedFiles: string[] = [];
    const invalidFiles: string[] = [];
    let totalSize = 0;

    files.forEach((file) => {
      totalSize += file.size;

      // Debug logging for file validation
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Validating file: ${file.name}, type: ${file.type}, size: ${file.size}`
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(
          `${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`
        );
      }

      // Check if file type is supported
      const isValid = isValidFileType(file);
      if (process.env.NODE_ENV === "development") {
        console.log(`File ${file.name} validation result: ${isValid}`);
      }

      if (!isValid) {
        const extension = "." + file.name.toLowerCase().split(".").pop();
        invalidFiles.push(
          `${file.name} (type: ${file.type || "unknown"}, ext: ${extension})`
        );
      }
    });

    if (oversizedFiles.length > 0) {
      errors.push(`Files exceed 1.6GB limit: ${oversizedFiles.join(", ")}`);
    }

    if (invalidFiles.length > 0) {
      errors.push(
        `Invalid file types (images and videos only): ${invalidFiles.join(
          ", "
        )}`
      );
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      errors.push(
        `Total file size exceeds 40GB limit (${(
          totalSize /
          1024 /
          1024 /
          1024
        ).toFixed(1)}GB)`
      );
    }

    return errors;
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setUseDefault28NewsLogo(false);
    }
  };

  const use28NewsLogo = () => {
    setUseDefault28NewsLogo(true);
    setLogoFile(null);
  };

  const selectDefaultLogo = (logoFile: string) => {
    setSelectedDefaultLogo(logoFile);
    setUseDefault28NewsLogo(true);
    setLogoFile(null);
  };

  const removeLogo = () => {
    setLogoFile(null);
  };

  const processImages = useCallback(async () => {
    // Define getEffectiveLogoFile inside the callback to avoid dependency issues
    const getEffectiveLogoFile = async (): Promise<File | null> => {
      if (useDefault28NewsLogo) {
        try {
          const response = await fetch(`/images/${selectedDefaultLogo}`);
          const blob = await response.blob();
          return new File([blob], selectedDefaultLogo, { type: "image/png" });
        } catch (error) {
          console.error("Error loading default logo:", error);
          return null;
        }
      }
      return logoFile;
    };

    if (selectedFiles.length === 0) return;
    if (!useDefault28NewsLogo && !logoFile) return;

    // Validate files before processing
    const validationErrors = validateFiles(selectedFiles);
    if (validationErrors.length > 0) {
      setApiError(validationErrors.join("; "));
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    setUploadProgress(0);
    setApiError(null);
    setJobStatus("submitting");
    setFileValidationErrors([]);

    // Initialize pending images
    const pendingImages: ProcessedImage[] = selectedFiles.map(
      (file, index) => ({
        id: `pending-${index}`,
        originalName: file.name,
        processedDataUrl: "",
        downloadUrl: "",
        status: "pending",
      })
    );
    setProcessedImages(pendingImages);

    try {
      const effectiveLogoFile = await getEffectiveLogoFile();

      // Calculate total upload size
      const totalSize =
        selectedFiles.reduce((sum, file) => sum + file.size, 0) +
        (effectiveLogoFile ? effectiveLogoFile.size : 0);
      setTotalUploadSize(totalSize);

      // Check if we need chunked upload for large files (>1.6GB)
      const hasLargeFiles = selectedFiles.some(
        (file) => file.size > 1600 * 1024 * 1024
      );

      let jobResponse;

      if (hasLargeFiles && selectedFiles.length === 1) {
        // Use batch upload for large files (chunked upload not implemented)
        if (process.env.NODE_ENV === "development") {
          console.log("Using batch upload for large file");
        }
        const chunkedResult = await ImageUploadService.submitBatchJob(
          selectedFiles,
          effectiveLogoFile,
          logoPosition,
          logoSize[0],
          logoOpacity[0],
          paddingX[0],
          paddingY[0],
          (progress: ProgressCallback) => {
            setUploadProgress(progress.progress);
            if (progress.uploadedBytes) {
              setUploadedSize(progress.uploadedBytes);
            }
          }
        );

        // Convert chunked response to job response format
        jobResponse = {
          success: chunkedResult.success,
          jobId: chunkedResult.jobId || "",
          message: chunkedResult.message || "Upload completed",
        };
      } else {
        // Use regular batch upload
        jobResponse = await ImageUploadService.submitBatchJob(
          selectedFiles,
          effectiveLogoFile,
          logoPosition,
          logoSize[0],
          logoOpacity[0],
          paddingX[0],
          paddingY[0],
          (progress: ProgressCallback) => {
            setUploadProgress(progress.progress);
            if (progress.uploadedBytes) {
              setUploadedSize(progress.uploadedBytes);
            }
          }
        );
      }

      // Ensure we show 100% when complete
      setUploadProgress(100);
      setUploadedSize(totalSize);

      if (!jobResponse.success) {
        setApiError(`Failed to submit job: ${jobResponse.message}`);
        setIsProcessing(false);
        return;
      }

      // Save job immediately after successful submission
      JobStorage.savePendingJob(
        jobResponse.jobId,
        selectedFiles.map((file) => file.name)
      );

      setJobStatus("processing");

      // Start polling for job status
      ImageUploadService.pollJobStatus(
        jobResponse.jobId,
        (status) => {
          // Update progress and processed images as they complete
          setProcessingProgress(status.progress);
          setJobStatus(status.status);

          // Update stored job with current status
          JobStorage.updateJob(jobResponse.jobId, status);

          // Update processed images with real-time results
          const updatedImages: ProcessedImage[] = selectedFiles.map(
            (file, index) => {
              const processedResult = status.processedImages.find(
                (img) => img.originalName === file.name
              );

              console.log("Processed result:", processedResult);

              if (processedResult) {
                // Check if this is a video result
                const isVideo = isVideoFile(file.name);

                return {
                  id: `processed-${index}`,
                  originalName: file.name,
                  processedDataUrl: processedResult.processedImageUrl,
                  thumbnailUrl: processedResult.thumbnailUrl,
                  fullImageUrl: processedResult.fullImageUrl,
                  processedVideoUrl: processedResult.processedVideoUrl,
                  fullVideoUrl: processedResult.fullVideoUrl,
                  downloadUrl: isVideo
                    ? processedResult.fullVideoUrl ||
                      processedResult.processedVideoUrl ||
                      processedResult.processedImageUrl
                    : processedResult.fullImageUrl ||
                      processedResult.processedImageUrl,
                  status: processedResult.status,
                  error: processedResult.error,
                };
              }

              return {
                id: `pending-${index}`,
                originalName: file.name,
                processedDataUrl: "",
                downloadUrl: "",
                status:
                  index < status.completedImages ? "processing" : "pending",
              };
            }
          );

          setProcessedImages(updatedImages);
        },
        (finalStatus) => {
          // Job completed
          setIsProcessing(false);
          setProcessingProgress(100);
          setJobStatus(finalStatus.status);

          if (finalStatus.status === "completed") {
            // Save completed job to localStorage
            JobStorage.saveJob(
              jobResponse.jobId,
              finalStatus,
              selectedFiles.map((file) => file.name)
            );
          } else if (finalStatus.status === "failed") {
            setApiError(finalStatus.error || "Job processing failed");
          }
        },
        (error) => {
          // Polling error
          setApiError(error);
          setIsProcessing(false);
          setJobStatus("failed");
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      setApiError(errorMessage);
      setIsProcessing(false);
      setJobStatus("failed");
      console.error("Error processing images:", error);
    }
  }, [
    selectedFiles,
    logoFile,
    useDefault28NewsLogo,
    selectedDefaultLogo,
    logoPosition,
    logoSize,
    logoOpacity,
    paddingX,
    paddingY,
  ]);

  const downloadImage = async (processedImage: ProcessedImage) => {
    try {
      // Check if this is a video file
      const isVideo = isVideoFile(processedImage.originalName);

      // Use appropriate URL based on file type
      const downloadUrl = isVideo
        ? processedImage.fullVideoUrl ||
          processedImage.processedVideoUrl ||
          processedImage.downloadUrl
        : processedImage.fullImageUrl || processedImage.downloadUrl;

      // Create a download URL using our proxy API
      const proxyUrl = `/api/download-image?url=${encodeURIComponent(
        downloadUrl
      )}`;

      // Create an anchor element and trigger download
      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = processedImage.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error: unknown) {
      if (process.env.NODE_ENV === "development") {
        console.error("Error downloading media:", error);
      }
      // Fallback to opening in a new tab if download fails
      const isVideo = isVideoFile(processedImage.originalName);
      const fallbackUrl = isVideo
        ? processedImage.fullVideoUrl ||
          processedImage.processedVideoUrl ||
          processedImage.downloadUrl
        : processedImage.fullImageUrl || processedImage.downloadUrl;
      window.open(fallbackUrl, "_blank");
    }
  };

  const downloadAll = async () => {
    setIsDownloadingAll(true);

    const completedImages = processedImages.filter((img) => {
      if (img.status !== "completed") return false;

      const isVideo = isVideoFile(img.originalName);
      return isVideo
        ? img.fullVideoUrl || img.processedVideoUrl || img.processedDataUrl
        : img.fullImageUrl || img.processedDataUrl;
    });

    for (let i = 0; i < completedImages.length; i++) {
      const img = completedImages[i];
      setTimeout(() => downloadImage(img), i * 200);
    }

    // Remove downloading state after all downloads are initiated + buffer time
    setTimeout(() => {
      setIsDownloadingAll(false);
    }, completedImages.length * 200 + 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-8 gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
              Media Logo Processor
            </h1>
            <p className="text-gray-600 text-lg">
              Upload your images and videos - we&apos;ll add your logo
              automatically
            </p>
          </div>
          <div className="flex justify-center md:justify-end">
            <Link href="/history">
              <Button variant="outline" className="flex items-center gap-2">
                <History className="w-4 h-4" />
                Job History
              </Button>
            </Link>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Logo Settings Panel */}
          <Card className="h-fit order-2 lg:order-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Logo Settings
              </CardTitle>
              <p className="text-sm text-gray-600">
                Customize how your logo appears on images and videos
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo Type */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Logo Type
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={logoType === "text" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogoType("text")}
                    className="flex-1"
                  >
                    Text Logo
                  </Button>
                  <Button
                    variant={logoType === "image" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogoType("image")}
                    className="flex-1"
                  >
                    Image Logo
                  </Button>
                </div>
              </div>

              {/* Upload Logo Image */}
              {logoType === "image" && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-3 block">
                    Upload Logo Image
                  </label>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Button
                        variant={useDefault28NewsLogo ? "default" : "outline"}
                        className="flex-1"
                        onClick={use28NewsLogo}
                      >
                        Use Default Logo
                      </Button>
                      <Button
                        variant={!useDefault28NewsLogo ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          logoInputRef.current?.click();
                        }}
                      >
                        Upload Logo
                      </Button>
                    </div>

                    {/* Default Logo Selection */}
                    {useDefault28NewsLogo && (
                      <div className="mt-2">
                        <label className="text-sm font-medium text-gray-700 mb-2 block">
                          Select Default Logo
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {defaultLogos.map((logo) => (
                            <div
                              key={logo.file}
                              onClick={() => selectDefaultLogo(logo.file)}
                              className={`border-2 p-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 ${
                                selectedDefaultLogo === logo.file
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-200"
                              }`}
                            >
                              <div className="h-16 flex items-center justify-center mb-1">
                                <Image
                                  src={`/images/${logo.file}`}
                                  alt={logo.name}
                                  width={64}
                                  height={64}
                                  className="h-full object-contain"
                                />
                              </div>
                              <p className="text-xs text-center font-medium truncate">
                                {logo.name}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      ref={logoInputRef}
                    />
                    {logoFile && !useDefault28NewsLogo && (
                      <p className="text-xs text-gray-600">
                        Selected: {logoFile.name}
                      </p>
                    )}

                    {/* Current Logo Preview */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Current Logo
                      </label>
                      <div className="w-36 h-36 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-300   relative">
                        {useDefault28NewsLogo ? (
                          <>
                            <Image
                              src={`/images/${selectedDefaultLogo}`}
                              alt="Selected Default Logo"
                              width={144}
                              height={144}
                              className="w-full h-full object-contain rounded-lg"
                            />
                          </>
                        ) : logoFile ? (
                          <>
                            <Image
                              src={
                                URL.createObjectURL(logoFile) ||
                                "/placeholder.svg"
                              }
                              alt="Logo preview"
                              width={144}
                              height={144}
                              className="w-full h-full object-contain rounded-lg"
                            />
                            <button
                              onClick={removeLogo}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <div className="text-gray-400 text-xs text-center">
                            No logo
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Logo Position */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Logo Position
                </label>
                <Select value={logoPosition} onValueChange={setLogoPosition}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top-left">Top Left</SelectItem>
                    <SelectItem value="top-right">Top Right</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Logo Size */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Logo Size: {logoSize[0]}%
                </label>
                <Slider
                  value={logoSize}
                  onValueChange={setLogoSize}
                  max={100}
                  min={5}
                  step={5}
                  className="w-full"
                />
              </div>

              {/* Logo Opacity */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Logo Opacity: {logoOpacity[0]}%
                </label>
                <Slider
                  value={logoOpacity}
                  onValueChange={setLogoOpacity}
                  max={100}
                  min={10}
                  step={10}
                  className="w-full"
                />
              </div>

              {/* Padding */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Padding X: {paddingX[0]}%
                </label>
                <Slider
                  value={paddingX}
                  onValueChange={setPaddingX}
                  max={20}
                  min={0}
                  step={0.5}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Padding Y: {paddingY[0]}%
                </label>
                <Slider
                  value={paddingY}
                  onValueChange={setPaddingY}
                  max={20}
                  min={0}
                  step={0.5}
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>

          {/* Upload Images Panel */}
          <Card className="h-fit order-1 lg:order-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Media Files
              </CardTitle>
              <div className="text-sm text-gray-600 space-y-1">
                <p>
                  Select multiple images and videos to process with logo overlay
                </p>
                <p className="text-xs">
                  <strong>Limits:</strong> Max 400 files, 1.6GB per file, 40GB
                  total
                </p>
                <p className="text-xs">
                  <strong>Images:</strong> JPG, PNG, GIF, WebP, BMP, TIFF
                </p>
                <p className="text-xs">
                  <strong>Videos:</strong> MP4, AVI, MOV, WMV, FLV, WebM, MKV,
                  M4V, 3GP
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Choose Media Files */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-3 block">
                  Choose Images & Videos
                </label>
                <Button
                  variant="outline"
                  className="w-full justify-start bg-transparent"
                  onClick={() =>
                    document.getElementById("image-upload")?.click()
                  }
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Choose Files
                </Button>
                <input
                  id="image-upload"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* File List */}
              {selectedFiles.length > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm text-gray-600">
                      {selectedFiles.length} file(s) selected
                    </p>
                    <p className="text-xs text-gray-500">
                      Total:{" "}
                      {(
                        selectedFiles.reduce(
                          (sum, file) => sum + file.size,
                          0
                        ) /
                        1024 /
                        1024
                      ).toFixed(1)}{" "}
                      MB
                    </p>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-2 bg-gray-50 rounded"
                      >
                        <div className="flex items-center flex-1 min-w-0">
                          <div className="flex-shrink-0 mr-3">
                            {isVideoFile(file.name) ? (
                              <Video className="w-4 h-4 text-blue-500" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-green-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-700 truncate block">
                              {file.name}
                            </span>
                            <span className="text-xs text-gray-500">
                              {isVideoFile(file.name) ? "Video" : "Image"} •{" "}
                              {file.type} •{" "}
                              {(file.size / 1024 / 1024).toFixed(1)} MB
                            </span>
                          </div>
                        </div>
                        <div className="ml-2 flex-shrink-0">
                          {file.size > 1600 * 1024 * 1024 ? (
                            <span className="text-xs text-red-600 font-medium">
                              Too large
                            </span>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Validation Errors */}
              {fileValidationErrors.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800 mb-1">
                    File Validation Issues:
                  </p>
                  <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                    {fileValidationErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* API Error Display */}
              {apiError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{apiError}</p>
                </div>
              )}

              {/* Process Button */}
              <div className="space-y-3">
                <Button
                  className="w-full bg-black hover:bg-gray-800 text-white py-3"
                  disabled={
                    selectedFiles.length === 0 ||
                    (!useDefault28NewsLogo && !logoFile) ||
                    isProcessing
                  }
                  onClick={processImages}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {jobStatus === "submitting"
                        ? "Submitting Job..."
                        : jobStatus === "processing"
                        ? `Processing... ${Math.round(processingProgress)}%`
                        : "Processing..."}
                    </>
                  ) : (
                    "Upload & Process Media Files"
                  )}
                </Button>

                {/* Progress Bars */}
                {isProcessing && (
                  <div className="space-y-2">
                    {/* Upload Progress */}
                    {(jobStatus === "submitting" ||
                      uploadPhase === "uploading") && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>
                            {uploadPhase === "uploading"
                              ? "Uploading files..."
                              : uploadPhase === "processing"
                              ? "Processing upload..."
                              : "Finalizing..."}
                          </span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ease-out ${
                              uploadPhase === "uploading"
                                ? "bg-blue-500"
                                : uploadPhase === "processing"
                                ? "bg-purple-500"
                                : "bg-green-500"
                            }`}
                            style={{ width: `${uploadProgress}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>
                            {(uploadedSize / (1024 * 1024)).toFixed(1)} MB /{" "}
                            {(totalUploadSize / (1024 * 1024)).toFixed(1)} MB
                          </span>
                          <span>
                            {uploadSpeed > 0
                              ? `${(uploadSpeed / (1024 * 1024)).toFixed(
                                  1
                                )} MB/s`
                              : ""}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {uploadPhase === "uploading" &&
                          uploadSpeed > 0 &&
                          totalUploadSize > uploadedSize
                            ? `Estimated time remaining: ${Math.ceil(
                                (totalUploadSize - uploadedSize) / uploadSpeed
                              )} seconds`
                            : uploadPhase === "processing"
                            ? "Processing on server..."
                            : uploadPhase === "completed"
                            ? "Upload complete, processing job..."
                            : ""}
                        </div>
                      </div>
                    )}

                    {/* Processing Progress */}
                    {jobStatus === "processing" && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>Processing media files...</span>
                          <span>{Math.round(processingProgress)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${processingProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview Area */}
        <div className="mt-8">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Processed Media</CardTitle>
                {processedImages.length > 0 && (
                  <Button
                    onClick={downloadAll}
                    variant="outline"
                    size="sm"
                    disabled={isDownloadingAll}
                    className="hover:bg-gray-100 hover:scale-105 transition-all duration-200"
                  >
                    {isDownloadingAll ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    {isDownloadingAll ? "Downloading..." : "Download All"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {processedImages.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {processedImages.map((media) => (
                    <div
                      key={media.id}
                      className="border rounded-lg overflow-hidden bg-white"
                    >
                      <div className="relative">
                        {media.status === "completed" &&
                        (media.thumbnailUrl || media.processedDataUrl) ? (
                          isVideoFile(media.originalName) ? (
                            // For videos, show thumbnail image but indicate it's a video
                            <div className="relative">
                              <Image
                                src={
                                  media.thumbnailUrl || media.processedDataUrl
                                }
                                alt={`Processed ${media.originalName}`}
                                width={400}
                                height={256}
                                className="w-full h-64 object-cover"
                              />
                              {/* Video play overlay */}
                              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                                <div className="w-16 h-16 bg-white bg-opacity-90 rounded-full flex items-center justify-center">
                                  <div className="w-0 h-0 border-l-[20px] border-l-black border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent ml-1"></div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <Image
                              src={media.thumbnailUrl || media.processedDataUrl}
                              alt={`Processed ${media.originalName}`}
                              width={400}
                              height={256}
                              className="w-full h-64 object-cover"
                            />
                          )
                        ) : (
                          <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                            {media.status === "processing" ? (
                              <div className="text-center">
                                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-500" />
                                <p className="text-sm text-gray-600">
                                  Processing...
                                </p>
                              </div>
                            ) : media.status === "failed" ? (
                              <div className="text-center text-red-500">
                                <X className="w-8 h-8 mx-auto mb-2" />
                                <p className="text-sm">Failed</p>
                              </div>
                            ) : (
                              <div className="text-center text-gray-400">
                                <Upload className="w-8 h-8 mx-auto mb-2" />
                                <p className="text-sm">Pending</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Status badge */}
                        <div
                          className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium ${
                            media.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : media.status === "processing"
                              ? "bg-blue-100 text-blue-800"
                              : media.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {media.status}
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="flex items-center mb-2">
                          <div className="flex-shrink-0 mr-2">
                            {isVideoFile(media.originalName) ? (
                              <Video className="w-4 h-4 text-blue-500" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-green-500" />
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-700 truncate">
                            {media.originalName}
                          </p>
                        </div>
                        {media.error && (
                          <p className="text-xs text-red-600 mb-2">
                            {media.error}
                          </p>
                        )}
                        <Button
                          onClick={() => downloadImage(media)}
                          size="sm"
                          className="w-full"
                          variant="outline"
                          disabled={
                            media.status !== "completed" ||
                            !(isVideoFile(media.originalName)
                              ? media.fullVideoUrl ||
                                media.processedVideoUrl ||
                                media.processedDataUrl
                              : media.fullImageUrl || media.processedDataUrl)
                          }
                        >
                          <Download className="w-3 h-3 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-400">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-2 bg-gray-200 rounded-lg flex items-center justify-center">
                      <Upload className="w-8 h-8" />
                    </div>
                    <p className="text-sm">
                      Processed images and videos will appear here
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
