import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const params = await context.params;
    const jobId = params.jobId;

    // Forward the request to the backend
    const backendResponse = await fetch(
      `${
        process.env.BACKEND_BASE_URL || "http://localhost:3000"
      }/job-status/${jobId}`,
      {
        method: "GET",
      }
    );

    if (!backendResponse.ok) {
      console.error(`Backend job status error: ${backendResponse.status} - ${backendResponse.statusText}`);
      
      // Return a mock response for development when backend is not available
      if (backendResponse.status === 404) {
        return NextResponse.json({
          jobId: params.jobId,
          status: "processing",
          progress: 50,
          totalImages: 1,
          completedImages: 0,
          processedImages: [],
          message: "Backend not available - showing mock data for development"
        }, {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      
      throw new Error(`Backend error: ${backendResponse.status}`);
    }

    // Get the response data
    const responseData = await backendResponse.json();
    console.log("Job status API route response:", responseData);

    // Return the response with proper CORS headers
    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("Job status API route error:", error);
    const params = await context.params;
    return NextResponse.json(
      {
        jobId: params.jobId,
        status: "failed",
        progress: 0,
        totalImages: 0,
        completedImages: 0,
        processedImages: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
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
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
