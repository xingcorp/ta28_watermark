import { JobStatus } from './api'

export interface StoredJob {
  jobId: string
  jobData: JobStatus
  timestamp: number
  originalFileNames: string[]
}

export class JobStorage {
  private static readonly STORAGE_KEY = '28news_processed_jobs'
  private static readonly EXPIRY_HOURS = 4

  // Save job to localStorage (can be pending, processing, or completed)
  static saveJob(jobId: string, jobData: JobStatus, originalFileNames: string[]): void {
    try {
      const existingJobs = this.getStoredJobs()
      
      const newJob: StoredJob = {
        jobId,
        jobData,
        timestamp: Date.now(),
        originalFileNames
      }

      // Add new job and remove duplicates
      const updatedJobs = [newJob, ...existingJobs.filter(job => job.jobId !== jobId)]
      
      // Clean up old jobs before saving
      const cleanedJobs = this.cleanExpiredJobs(updatedJobs)
      
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleanedJobs))
    } catch (error) {
      console.error('Error saving job to localStorage:', error)
    }
  }

  // Get all stored jobs
  static getStoredJobs(): StoredJob[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return []
      
      const jobs: StoredJob[] = JSON.parse(stored)
      return this.cleanExpiredJobs(jobs)
    } catch (error) {
      console.error('Error reading jobs from localStorage:', error)
      return []
    }
  }

  // Get specific job by ID
  static getJob(jobId: string): StoredJob | null {
    const jobs = this.getStoredJobs()
    return jobs.find(job => job.jobId === jobId) || null
  }

  // Clean up expired jobs (older than 24 hours)
  private static cleanExpiredJobs(jobs: StoredJob[]): StoredJob[] {
    const expiryTime = Date.now() - (this.EXPIRY_HOURS * 60 * 60 * 1000)
    const validJobs = jobs.filter(job => job.timestamp > expiryTime)
    
    // Update localStorage if we removed any jobs
    if (validJobs.length !== jobs.length) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(validJobs))
      } catch (error) {
        console.error('Error updating localStorage after cleanup:', error)
      }
    }
    
    return validJobs
  }

  // Clear all stored jobs
  static clearAllJobs(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY)
    } catch (error) {
      console.error('Error clearing jobs from localStorage:', error)
    }
  }

  // Get jobs count
  static getJobsCount(): number {
    return this.getStoredJobs().length
  }

  // Check if job exists
  static hasJob(jobId: string): boolean {
    return this.getJob(jobId) !== null
  }

  // Save pending job immediately after submission
  static savePendingJob(jobId: string, originalFileNames: string[]): void {
    const pendingJobData: JobStatus = {
      jobId,
      status: "pending",
      progress: 0,
      totalImages: originalFileNames.length,
      completedImages: 0,
      processedImages: []
    }
    
    console.log('Saving pending job:', {
      jobId,
      totalFiles: originalFileNames.length,
      fileNames: originalFileNames
    });
    
    this.saveJob(jobId, pendingJobData, originalFileNames)
  }

  // Update existing job with new status
  static updateJob(jobId: string, jobData: JobStatus): void {
    const existingJob = this.getJob(jobId)
    if (existingJob) {
      console.log('Updating job:', {
        jobId,
        oldStatus: existingJob.jobData.status,
        newStatus: jobData.status,
        oldTotalImages: existingJob.jobData.totalImages,
        newTotalImages: jobData.totalImages,
        oldProcessedCount: existingJob.jobData.processedImages?.length || 0,
        newProcessedCount: jobData.processedImages?.length || 0,
        processedImages: jobData.processedImages
      });
      
      // Preserve totalImages from original job if the new data has 0
      if (jobData.totalImages === 0 && existingJob.jobData.totalImages > 0) {
        console.log('Preserving totalImages from existing job:', existingJob.jobData.totalImages);
        jobData.totalImages = existingJob.jobData.totalImages;
      }
      
      this.saveJob(jobId, jobData, existingJob.originalFileNames)
    } else {
      console.warn('Attempted to update non-existent job:', jobId);
    }
  }
}
