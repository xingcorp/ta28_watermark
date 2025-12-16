# Backend Integration Guide - 28News Media Editor

## Overview

This guide explains how to implement the backend API endpoints for the 28News Media Editor async job processing system. The frontend submits batch image processing jobs and polls for real-time status updates.

## Architecture

```
Frontend → Next.js API Routes → Your Backend
                ↓
        Async Job Processing
                ↓
        Real-time Status Updates
```

## Required Endpoints

### 1. Submit Batch Job

**Endpoint**: `POST /submit-batch-job`

**Purpose**: Accept multiple images and processing parameters, return job ID immediately

**Request Format**: `multipart/form-data`

```javascript
FormData {
  images: File[],           // Multiple image files (key: "images")
  logo: File,              // Logo file (optional if using default)
  logoPosition: string,    // "top-left", "top-right", "bottom-left", "bottom-right", "center"
  logoSize: string,        // "15" (percentage, 5-100)
  logoOpacity: string,     // "80" (percentage, 10-100)
  padding: string          // "80" (pixels, 20-200)
}
```

**Response Format**: `application/json`

```javascript
{
  "success": true,
  "jobId": "job-uuid-123",
  "message": "Job submitted successfully"
}

// Error response
{
  "success": false,
  "jobId": "",
  "error": "Error message"
}
```

**Implementation Example** (Python/Flask):

```python
@app.route('/submit-batch-job', methods=['POST'])
def submit_batch_job():
    try:
        # Extract files and parameters
        images = request.files.getlist('images')
        logo = request.files.get('logo')
        logo_position = request.form.get('logoPosition', 'bottom-right')
        logo_size = int(request.form.get('logoSize', 15))
        logo_opacity = int(request.form.get('logoOpacity', 80))
        padding = int(request.form.get('padding', 80))
        
        # Generate unique job ID
        job_id = f"job-{uuid.uuid4()}"
        
        # Initialize job status
        jobs[job_id] = {
            "status": "pending",
            "progress": 0,
            "totalImages": len(images),
            "completedImages": 0,
            "processedImages": [],
            "error": None
        }
        
        # Start background processing
        threading.Thread(
            target=process_images_async,
            args=(job_id, images, logo, logo_position, logo_size, logo_opacity, padding)
        ).start()
        
        return jsonify({
            "success": True,
            "jobId": job_id,
            "message": "Job submitted successfully"
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "jobId": "",
            "error": str(e)
        }), 500
```

### 2. Job Status Polling

**Endpoint**: `GET /job-status/{jobId}`

**Purpose**: Return current job status and completed images

**Response Format**: `application/json`

```javascript
{
  "jobId": "job-uuid-123",
  "status": "processing",           // "pending" | "processing" | "completed" | "failed"
  "progress": 60,                   // 0-100 percentage
  "totalImages": 5,                 // Total images in job
  "completedImages": 3,             // Images completed so far
  "processedImages": [              // Array of completed images
    {
      "originalName": "image1.jpg",
      "processedImageUrl": "/processed/job-uuid-123/image1_processed.jpg", // For backward compatibility
      "thumbnailUrl": "/processed/job-uuid-123/image1_thumbnail.jpg",      // New field for compressed thumbnail
      "fullImageUrl": "/processed/job-uuid-123/image1_processed.jpg",      // New field for full-size image
      "status": "completed"
    },
    {
      "originalName": "image2.jpg", 
      "processedImageUrl": "/processed/job-uuid-123/image2_processed.jpg",
      "thumbnailUrl": "/processed/job-uuid-123/image2_thumbnail.jpg",
      "fullImageUrl": "/processed/job-uuid-123/image2_processed.jpg",
      "status": "completed"
    },
    {
      "originalName": "image3.jpg",
      "processedImageUrl": "",
      "thumbnailUrl": "",
      "fullImageUrl": "",
      "status": "failed",
      "error": "Invalid image format"
    }
  ],
  "error": null
}
```

**Implementation Example**:

```python
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    if job_id not in jobs:
        return jsonify({
            "jobId": job_id,
            "status": "failed",
            "progress": 0,
            "totalImages": 0,
            "completedImages": 0,
            "processedImages": [],
            "error": "Job not found"
        }), 404
    
    job = jobs[job_id]
    return jsonify({
        "jobId": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "totalImages": job["totalImages"],
        "completedImages": job["completedImages"],
        "processedImages": job["processedImages"],
        "error": job.get("error")
    })
```

## Background Processing Implementation

### Job Processing Function

```python
def process_images_async(job_id, images, logo, logo_position, logo_size, logo_opacity, padding):
    """Process images in background thread"""
    try:
        jobs[job_id]["status"] = "processing"
        
        for i, image in enumerate(images):
            try:
                # Process individual image and get both full image and thumbnail paths
                processed_images = process_single_image(
                    image, logo, logo_position, logo_size, logo_opacity, padding, job_id
                )
                
                # Update job status with completed image including both URLs
                jobs[job_id]["processedImages"].append({
                    "originalName": image.filename,
                    # For backward compatibility
                    "processedImageUrl": f"/processed/{job_id}/{processed_images['full_image']}",
                    # New fields for thumbnail and full-size image
                    "thumbnailUrl": f"/processed/{job_id}/{processed_images['thumbnail']}",
                    "fullImageUrl": f"/processed/{job_id}/{processed_images['full_image']}",
                    "status": "completed"
                })
                
                jobs[job_id]["completedImages"] += 1
                jobs[job_id]["progress"] = (jobs[job_id]["completedImages"] / jobs[job_id]["totalImages"]) * 100
                
            except Exception as e:
                # Handle individual image failure
                jobs[job_id]["processedImages"].append({
                    "originalName": image.filename,
                    "processedImageUrl": "",
                    "thumbnailUrl": "",
                    "fullImageUrl": "",
                    "status": "failed",
                    "error": str(e)
                })
                jobs[job_id]["completedImages"] += 1
                jobs[job_id]["progress"] = (jobs[job_id]["completedImages"] / jobs[job_id]["totalImages"]) * 100
        
        # Mark job as completed
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        
    except Exception as e:
        # Mark entire job as failed
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
```

### Thumbnail Compression

### Overview

To improve frontend performance, the backend should now generate two versions of each processed image:

1. **Compressed Thumbnail**: A smaller, lower-quality version for faster loading in the UI
2. **Full-Size Image**: The original high-quality processed image for downloads

This dual approach allows the frontend to display images quickly while still providing high-quality downloads.

### Implementation Requirements

- Generate a compressed thumbnail (recommended size: max 800px width/height)
- Use higher compression (lower quality) for thumbnails (recommended: 50-60% quality)
- Return both URLs in the job status response
- Maintain backward compatibility with `processedImageUrl`

## Image Processing Function

```python
def process_single_image(image, logo, logo_position, logo_size, logo_opacity, padding, job_id):
    """Process a single image with logo overlay and generate thumbnail"""
    
    # Create job directory
    job_dir = f"processed/{job_id}"
    os.makedirs(job_dir, exist_ok=True)
    
    # Load and process image
    img = Image.open(image)
    
    if logo:
        logo_img = Image.open(logo)
    else:
        # Use default 28news logo
        logo_img = Image.open("static/images/28news-logo.png")
    
    # Calculate logo dimensions
    img_width, img_height = img.size
    logo_width = int(min(img_width, img_height) * (logo_size / 100))
    logo_height = int(logo_img.height * (logo_width / logo_img.width))
    
    # Resize logo
    logo_img = logo_img.resize((logo_width, logo_height), Image.Resampling.LANCZOS)
    
    # Calculate position
    positions = {
        "top-left": (padding, padding),
        "top-right": (img_width - logo_width - padding, padding),
        "bottom-left": (padding, img_height - logo_height - padding),
        "bottom-right": (img_width - logo_width - padding, img_height - logo_height - padding),
        "center": ((img_width - logo_width) // 2, (img_height - logo_height) // 2)
    }
    
    position = positions.get(logo_position, positions["bottom-right"])
    
    # Apply opacity
    if logo_img.mode != 'RGBA':
        logo_img = logo_img.convert('RGBA')
    
    # Create transparent overlay
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    overlay.paste(logo_img, position)
    
    # Apply opacity
    alpha = int(255 * (logo_opacity / 100))
    overlay.putalpha(alpha)
    
    # Composite images
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    result = Image.alpha_composite(img, overlay)
    
    # Convert back to RGB for JPEG
    if result.mode == 'RGBA':
        result = result.convert('RGB')
    
    # Save full-size processed image (high quality)
    full_filename = f"{os.path.splitext(image.filename)[0]}_processed.jpg"
    full_path = os.path.join(job_dir, full_filename)
    result.save(full_path, 'JPEG', quality=90)
    
    # Generate and save thumbnail (lower quality, smaller size)
    thumbnail = result.copy()
    
    # Resize thumbnail while maintaining aspect ratio
    MAX_THUMBNAIL_SIZE = 800  # Maximum width or height
    thumbnail.thumbnail((MAX_THUMBNAIL_SIZE, MAX_THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
    
    thumbnail_filename = f"{os.path.splitext(image.filename)[0]}_thumbnail.jpg"
    thumbnail_path = os.path.join(job_dir, thumbnail_filename)
    thumbnail.save(thumbnail_path, 'JPEG', quality=60)  # Lower quality for thumbnails
    
    return {
        'full_image': full_filename,
        'thumbnail': thumbnail_filename
    }
```

## File Serving

### Static File Serving

Ensure processed images are accessible via HTTP:

```python
# Flask example
@app.route('/processed/<job_id>/<filename>')
def serve_processed_image(job_id, filename):
    return send_from_directory(f'processed/{job_id}', filename)
```

### Directory Structure

```
your-backend/
├── processed/
│   ├── job-uuid-123/
│   │   ├── image1_processed.jpg
│   │   ├── image2_processed.jpg
│   │   └── image3_processed.jpg
│   └── job-uuid-456/
│       └── ...
├── static/
│   └── images/
│       └── 28news-logo.png
└── app.py
```

## Data Storage

### In-Memory Storage (Simple)

```python
# Global dictionary for job storage
jobs = {}
```

### Database Storage (Production)

```python
# Example with SQLAlchemy
class Job(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    status = db.Column(db.String(20), default='pending')
    progress = db.Column(db.Integer, default=0)
    total_images = db.Column(db.Integer)
    completed_images = db.Column(db.Integer, default=0)
    error = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ProcessedImage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.String(50), db.ForeignKey('job.id'))
    original_name = db.Column(db.String(255))
    processed_url = db.Column(db.String(500))  # For backward compatibility
    thumbnail_url = db.Column(db.String(500))  # New field for compressed thumbnail
    full_image_url = db.Column(db.String(500))  # New field for full-size image
    status = db.Column(db.String(20))
    error = db.Column(db.Text)
```

## Error Handling

### Common Error Scenarios

1. **Invalid image format**
2. **File too large**
3. **Processing timeout**
4. **Disk space issues**
5. **Logo file missing**

### Error Response Format

```javascript
{
  "success": false,
  "jobId": "job-uuid-123",
  "error": "Detailed error message"
}
```

## Performance Considerations

### 1. Concurrent Processing
- Use thread pools or async processing
- Limit concurrent jobs to prevent resource exhaustion

### 2. File Cleanup
- Implement cleanup job for old processed images
- Set retention policy (e.g., delete after 4 hours to match frontend expiration)
- Clean up both thumbnails and full-size images

### 3. Resource Limits
- Set maximum file size limits
- Limit number of images per job
- Implement rate limiting

### 4. Thumbnail Optimization
- Consider using WebP format for thumbnails (better compression)
- Implement progressive loading for thumbnails
- Cache thumbnails aggressively (longer cache headers)
- Consider using a CDN for serving images
- Pre-compute common thumbnail sizes

## Testing

### Test Endpoints

```bash
# Submit job
curl -X POST http://localhost:3000/submit-batch-job \
  -F "images=@image1.jpg" \
  -F "images=@image2.jpg" \
  -F "logoPosition=bottom-right" \
  -F "logoSize=15" \
  -F "logoOpacity=80" \
  -F "padding=80"

# Check status
curl http://localhost:3000/job-status/job-uuid-123
```

## Frontend Integration

The frontend will:
1. Submit batch job via `/api/submit-batch-job`
2. Poll status every 2 seconds via `/api/job-status/{jobId}`
3. Display real-time progress and completed images
4. Use thumbnails for image display in the UI for faster loading
5. Use full-size images for downloads (individual or batch)

### Thumbnail Integration

The frontend has been updated to:
- Display compressed thumbnails in the UI grid for better performance
- Use full-size images when users download individual images
- Use full-size images when users click "Download All"
- Fall back to processedImageUrl if thumbnailUrl is not available (backward compatibility)

## Security Considerations

1. **File validation**: Check file types and sizes
2. **Path traversal**: Sanitize filenames
3. **Rate limiting**: Prevent abuse
4. **Authentication**: Add if required
5. **CORS**: Configure properly for frontend domain

This implementation provides a robust async job processing system with real-time updates for the 28News Media Editor frontend.
