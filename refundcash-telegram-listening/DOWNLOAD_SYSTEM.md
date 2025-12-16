# Download System Documentation

## Overview
The system has been modified to use a **download-on-demand** approach instead of sending files directly through webhooks. This improves performance and gives users control over when to download files.

## How It Works

### 1. File Processing
- When media messages are received, files are downloaded to `./media_temp/`
- File metadata is stored in Redis with 24-hour expiry
- Download links are generated and sent to webhook

### 2. Webhook Payload
Instead of files, the webhook now receives:
```json
{
  "metadata": {
    "groupId": "group_123_456",
    "timestamp": 1692012345,
    "messageCount": 3
  },
  "files": [
    {
      "fileId": "group_123_456_789_1692012345",
      "downloadLink": "http://localhost:3000/download/group_123_456_789_1692012345",
      "type": "photo",
      "caption": "Image caption",
      "messageId": 789,
      "fileName": "image.jpg",
      "mimeType": "image/jpeg",
      "fileSize": 1024000,
      "timestamp": 1692012345
    }
  ],
  "totalFiles": 1
}
```

### 3. Download Server
- Runs on port 3000 (configurable via `DOWNLOAD_PORT`)
- Endpoint: `GET /download/{fileId}`
- Returns the actual file with proper headers
- Includes security checks and error handling

## Endpoints

### Download File
```
GET /download/{fileId}
```
- Downloads the actual file
- Sets proper Content-Type and filename headers
- Returns 404 if file not found or expired

### Health Check
```
GET /health
```
- Returns server status

### File Info (Debug)
```
GET /info/{fileId}
```
- Returns file metadata without exposing file path
- Useful for debugging

## Configuration

### Environment Variables
```bash
# Download server port
DOWNLOAD_PORT=3000

# Base URL for download links
DOWNLOAD_BASE_URL=http://localhost:3000

# Redis URL (shared with main app)
REDIS_URL=redis://localhost:6379
```

### PM2 Configuration
Both services run under PM2:
- `signals-forward` - Main Telegram listener
- `download-server` - File download API

## File Lifecycle

1. **Upload**: File downloaded from Telegram → stored in `./media_temp/`
2. **Metadata**: File info stored in Redis (24h TTL)
3. **Webhook**: Download link sent to webhook
4. **Download**: User requests file via download link
5. **Cleanup**: Files older than 24h automatically deleted

## Benefits

✅ **Reduced Bandwidth**: Only download files when needed
✅ **Better Performance**: Webhook calls are faster (JSON only)
✅ **User Control**: Download files on-demand
✅ **Scalability**: Can handle large files without webhook timeouts
✅ **Storage Management**: Automatic cleanup after 24 hours

## Security Notes

- File paths are not exposed in API responses
- Download links expire after 24 hours
- Files are automatically cleaned up
- Redis keys have TTL to prevent memory leaks

## Deployment

1. Install Express.js dependency:
```bash
npm install express
```

2. Start both services:
```bash
pm2 start ecosystem.config.js
```

3. Check status:
```bash
pm2 status
pm2 logs download-server
```

## Testing

Test the download endpoint:
```bash
# Check health
curl http://localhost:3000/health

# Download a file (replace with actual fileId)
curl -O http://localhost:3000/download/group_123_456_789_1692012345
```
