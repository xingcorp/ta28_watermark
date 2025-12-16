/**
 * BullMQ Queue Configuration with Environment Suffix
 * This utility helps create environment-specific queue names
 */

export class QueueConfig {
  private static getEnvironmentSuffix(): string {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const customSuffix = process.env.BULLMQ_QUEUE_SUFFIX;
    
    // Use custom suffix if provided, otherwise use NODE_ENV
    return customSuffix || nodeEnv;
  }

  /**
   * Get queue name with environment suffix
   * @param baseName - Base name of the queue (e.g., 'image-processing', 'batch-jobs')
   * @returns Queue name with environment suffix (e.g., 'image-processing-development')
   */
  static getQueueName(baseName: string): string {
    const suffix = this.getEnvironmentSuffix();
    return `${baseName}-${suffix}`;
  }

  /**
   * Common queue names used in the application
   */
  static readonly QUEUES = {
    IMAGE_PROCESSING: 'image-processing',
    BATCH_JOBS: 'batch-jobs',
    VIDEO_PROCESSING: 'video-processing',
    MEDIA_PROCESSING: 'media-processing',
  } as const;

  /**
   * Get all queue names with environment suffix
   */
  static getAllQueueNames(): Record<string, string> {
    return Object.entries(this.QUEUES).reduce((acc, [key, baseName]) => {
      acc[key] = this.getQueueName(baseName);
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Get Redis connection configuration
   */
  static getRedisConfig() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
    };
  }
}

// Export queue names for easy access
export const QUEUE_NAMES = QueueConfig.getAllQueueNames();

// Example usage:
// const imageQueue = new Queue(QueueConfig.getQueueName('image-processing'), { connection: QueueConfig.getRedisConfig() });
// const batchQueue = new Queue(QUEUE_NAMES.BATCH_JOBS, { connection: QueueConfig.getRedisConfig() });
