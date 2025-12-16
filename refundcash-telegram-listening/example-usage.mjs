import { addImageProcessingJob, getJobStatus, getQueueStats } from './src/queue-utils.mjs';
import fs from 'fs';
import path from 'path';

// Example: How to use the image processing queue from any service
async function exampleUsage() {
  try {
    console.log('🔍 Getting queue stats...');
    const stats = await getQueueStats();
    console.log('Queue stats:', stats);

    // Example: Process images from signal-forward or any other service
    const exampleImages = [
      {
        buffer: fs.readFileSync('./images/28news-logo.png'), // Use existing logo as test image
        originalname: 'test-image-1.png',
        mimetype: 'image/png'
      }
    ];

    console.log('\n📤 Adding job to queue...');
    const result = await addImageProcessingJob({
      images: exampleImages,
      logoPath: path.join(process.cwd(), 'images', '28news-logo.png'),
      options: {
        logoSize: 15,
        logoOpacity: 80,
        padding: 20,
        logoPosition: 'bottom-right'
      },
      priority: 1,
      source: 'example-usage'
    });

    console.log(`✅ Job ${result.jobId} added to queue`);

    // Monitor job status
    let jobStatus;
    let attempts = 0;
    const maxAttempts = 30;

    console.log('\n⏳ Monitoring job status...');
    do {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      jobStatus = await getJobStatus(result.jobId);
      
      if (jobStatus) {
        console.log(`📊 Job ${result.jobId}: ${jobStatus.status} (${jobStatus.progress}%)`);
      }
      
      attempts++;
    } while (
      jobStatus && 
      !['completed', 'failed'].includes(jobStatus.status) && 
      attempts < maxAttempts
    );

    if (jobStatus) {
      console.log('\n🎉 Final job status:', {
        jobId: result.jobId,
        status: jobStatus.status,
        progress: jobStatus.progress,
        processedImages: jobStatus.returnvalue?.processedImages?.length || 0
      });

      if (jobStatus.status === 'completed' && jobStatus.returnvalue?.processedImages) {
        console.log('\n🖼️  Processed images:');
        jobStatus.returnvalue.processedImages.forEach((img, index) => {
          console.log(`  ${index + 1}. ${img.originalName}`);
          console.log(`     Thumbnail: http://localhost:3000${img.thumbnailUrl}`);
          console.log(`     Full size: http://localhost:3000${img.fullImageUrl}`);
        });
      }
    }

    console.log('\n📈 Final queue stats:');
    const finalStats = await getQueueStats();
    console.log(finalStats);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage().then(() => {
    console.log('\n✨ Example completed');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Example failed:', error);
    process.exit(1);
  });
}

export { exampleUsage };
