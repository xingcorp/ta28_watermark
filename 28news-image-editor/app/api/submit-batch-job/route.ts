import { NextRequest, NextResponse } from "next/server";

// Configure runtime and body size limit
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    console.log('Submit batch job API called');
    
    // Check content length
    const contentLength = request.headers.get('content-length');
    console.log('Content length:', contentLength);
    
    if (contentLength && parseInt(contentLength) > 2 * 1024 * 1024 * 1024) { // 2GB limit
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 2GB.' },
        { status: 413 }
      );
    }

    // Get the form data from the request with streaming
    const formData = await request.formData();
    console.log('FormData received, entries:', Array.from(formData.keys()));

    // Forward the request to the backend with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    const backendResponse = await fetch(
      `${process.env.BACKEND_BASE_URL || "http://localhost:3000"}/submit-batch-job`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
        headers: {
          // Don't set Content-Type, let fetch set it with boundary for FormData
        }
      }
    );

    clearTimeout(timeoutId);

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.status}`);
    }

    // Get the response data
    const responseData = await backendResponse.json();

    // Return the response with proper CORS headers
    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("Submit batch job API route error:", error);
    return NextResponse.json(
      {
        success: false,
        jobId: "",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
