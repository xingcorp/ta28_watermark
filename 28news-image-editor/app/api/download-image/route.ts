import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get the image URL from the query parameter
    const imageUrl = request.nextUrl.searchParams.get('url');
    
    if (!imageUrl) {
      return NextResponse.json({ error: 'Image URL is required' }, { status: 400 });
    }
    // Normalize URL: support both absolute URLs and relative paths like /processed/...
    let targetUrl: string;
    try {
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        // Absolute URL: use as-is (allows future use with external CDNs)
        targetUrl = new URL(imageUrl).toString();
      } else {
        // Relative path: fetch directly from backend service inside Docker network
        const backendBase = process.env.BACKEND_BASE_URL || 'http://backend:3000';
        console.log('download-image: resolving relative URL', { imageUrl, backendBase });
        targetUrl = new URL(imageUrl, backendBase).toString();
      }
    } catch (e) {
      console.error('Invalid image URL provided to download-image route:', imageUrl, e);
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
    }

    // Fetch the image from the resolved URL
    console.log('download-image: fetching', targetUrl);
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    // Get the image data as an array buffer
    const imageBuffer = await response.arrayBuffer();
    
    // Get the content type from the original response
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Create a new response with the image data
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Download image API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
