# BullMQ Environment Configuration

This project now supports environment-specific BullMQ queue names to prevent conflicts between development and production environments.

## Configuration

### 1. Environment Variables

Set the `BULLMQ_QUEUE_SUFFIX` environment variable:

```bash
# For development
BULLMQ_QUEUE_SUFFIX=development

# For production  
BULLMQ_QUEUE_SUFFIX=production
```

If not set, it will default to the `NODE_ENV` value.

### 2. PM2 Configuration

The `ecosystem.config.js` now includes environment-specific configurations:

```javascript
// Production environment
env: {
  NODE_ENV: "production",
  BULLMQ_QUEUE_SUFFIX: "production",
  // ... other vars
}

// Development environment  
env_development: {
  NODE_ENV: "development", 
  BULLMQ_QUEUE_SUFFIX: "development",
  // ... other vars
}
```

### 3. Usage in Backend

Use the `QueueConfig` utility class in your backend:

```typescript
import { QueueConfig, QUEUE_NAMES } from './lib/queue-config';

// Create queues with environment suffix
const imageQueue = new Queue(QueueConfig.getQueueName('image-processing'), {
  connection: QueueConfig.getRedisConfig()
});

// Or use predefined names
const batchQueue = new Queue(QUEUE_NAMES.BATCH_JOBS, {
  connection: QueueConfig.getRedisConfig()
});
```

## Queue Names

With `NODE_ENV=development`:
- `image-processing-development`
- `batch-jobs-development` 
- `video-processing-development`
- `media-processing-development`

With `NODE_ENV=production`:
- `image-processing-production`
- `batch-jobs-production`
- `video-processing-production` 
- `media-processing-production`

## PM2 Commands

```bash
# Start in development mode
pm2 start ecosystem.config.js --env development

# Start in production mode  
pm2 start ecosystem.config.js --env production

# Restart with specific environment
pm2 restart ecosystem.config.js --env development
```

This ensures your local development queues won't interfere with production queues when using the same Redis instance.
