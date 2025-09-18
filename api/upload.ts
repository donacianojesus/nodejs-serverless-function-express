import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers BEFORE any other operations
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Log the request to debug
    console.log('Request headers:', req.headers);
    console.log('Request body type:', typeof req.body);
    console.log('Request body keys:', Object.keys(req.body || {}));

    // For now, return test data to verify the endpoint works
    return res.status(200).json({
      success: true,
      message: 'Upload endpoint is working! File parsing will be implemented next.',
      data: {
        courseName: 'Test Course',
        courseCode: 'TEST 101',
        semester: 'Spring',
        year: 2025,
        events: [
          {
            id: 'test-event-1',
            title: 'Test Assignment',
            date: new Date().toISOString(),
            type: 'assignment',
            priority: 'medium',
            completed: false,
            description: 'This is a test assignment'
          }
        ]
      },
      metadata: {
        confidence: 100,
        method: 'test',
        fileType: 'test',
        eventsFound: 1
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error during file processing',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}