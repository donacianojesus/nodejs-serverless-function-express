import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PdfParserService } from './services/pdfParser';
import { SyllabusParserService } from './services/syllabusParser';

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
    // Parse multipart form data
    const formData = await parseMultipartForm(req);
    
    if (!formData.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    // Validate file type
    if (!formData.file.type.includes('pdf')) {
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are supported'
      });
    }

    // Validate file size (10MB limit)
    if (formData.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File size exceeds 10MB limit'
      });
    }

    console.log('Processing file:', {
      name: formData.file.name,
      size: formData.file.size,
      type: formData.file.type,
      courseName: formData.courseName,
      courseCode: formData.courseCode,
      semester: formData.semester,
      year: formData.year
    });

    // Parse PDF and extract text
    const pdfResult = await PdfParserService.parsePdf(Buffer.from(formData.file.data));
    
    // Check if it's likely a syllabus
    if (!PdfParserService.isLikelySyllabus(pdfResult.text)) {
      return res.status(400).json({
        success: false,
        error: 'File does not appear to be a syllabus. Please upload a valid syllabus document.',
        metadata: {
          confidence: 0,
          method: 'validation',
          fileType: 'pdf',
          eventsFound: 0
        }
      });
    }

    // Clean the extracted text
    const cleanedText = PdfParserService.cleanText(pdfResult.text);
    
    console.log('PDF parsed successfully:', {
      pages: pdfResult.pages,
      textLength: cleanedText.length,
      preview: cleanedText.substring(0, 200) + '...'
    });

    // Parse syllabus using our parsing service
    const parsingResult = await SyllabusParserService.parseSyllabus(
      cleanedText,
      formData.courseName,
      formData.courseCode,
      formData.semester,
      formData.year ? parseInt(formData.year) : undefined
    );

    if (!parsingResult.success || !parsingResult.data) {
      return res.status(500).json({
        success: false,
        error: parsingResult.error || 'Failed to parse syllabus',
        metadata: {
          confidence: parsingResult.confidence,
          method: parsingResult.method || 'unknown',
          fileType: 'pdf',
          eventsFound: 0
        }
      });
    }

    console.log('Syllabus parsed successfully:', {
      courseName: parsingResult.data.courseName,
      courseCode: parsingResult.data.courseCode,
      eventsCount: parsingResult.data.events.length,
      confidence: parsingResult.confidence,
      method: parsingResult.method
    });

    // Return successful response
    return res.status(200).json({
      success: true,
      data: {
        courseName: parsingResult.data.courseName,
        courseCode: parsingResult.data.courseCode,
        semester: parsingResult.data.semester,
        year: parsingResult.data.year,
        events: parsingResult.data.events.map(event => ({
          id: event.id,
          title: event.title,
          date: event.date.toISOString(),
          type: event.type,
          priority: event.priority,
          completed: event.completed,
          description: event.description,
          time: event.time
        }))
      },
      metadata: {
        confidence: parsingResult.confidence,
        method: parsingResult.method || 'unknown',
        fileType: 'pdf',
        eventsFound: parsingResult.data.events.length,
        pages: pdfResult.pages
      }
    });

  } catch (error) {
    console.error('Upload processing error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error during file processing',
      message: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        confidence: 0,
        method: 'error',
        fileType: 'unknown',
        eventsFound: 0
      }
    });
  }
}

// Helper function to parse multipart form data
async function parseMultipartForm(req: VercelRequest): Promise<{
  file?: { name: string; type: string; size: number; data: Buffer };
  courseName?: string;
  courseCode?: string;
  semester?: string;
  year?: string;
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let boundary = '';
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        
        // Extract boundary from content-type header
        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch) {
          throw new Error('No boundary found in multipart form data');
        }
        
        boundary = '--' + boundaryMatch[1];
        const parts = buffer.toString('binary').split(boundary);
        
        const result: any = {};
        
        for (const part of parts) {
          if (part.includes('Content-Disposition: form-data')) {
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;
            
            const headers = part.substring(0, headerEnd);
            const content = part.substring(headerEnd + 4);
            
            // Parse field name
            const nameMatch = headers.match(/name="([^"]+)"/);
            if (!nameMatch) continue;
            
            const fieldName = nameMatch[1];
            
            if (fieldName === 'file') {
              // Parse file field
              const filenameMatch = headers.match(/filename="([^"]+)"/);
              const contentTypeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
              
              if (filenameMatch) {
                result.file = {
                  name: filenameMatch[1],
                  type: contentTypeMatch ? contentTypeMatch[1] : 'application/pdf',
                  size: Buffer.from(content, 'binary').length,
                  data: Buffer.from(content, 'binary')
                };
              }
            } else {
              // Parse text field
              result[fieldName] = content.replace(/\r\n$/, '');
            }
          }
        }
        
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    
    req.on('error', reject);
  });
}