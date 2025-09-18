import pdf from 'pdf-parse';
import { Buffer } from 'buffer';

export interface PdfParseResult {
  text: string;
  pages: number;
  info?: any;
  metadata?: any;
}

export class PdfParserService {
  /**
   * Parse PDF file and extract text content
   */
  static async parsePdf(buffer: Buffer): Promise<PdfParseResult> {
    try {
      const data = await pdf(buffer);
      
      return {
        text: data.text,
        pages: data.numpages,
        info: data.info,
        metadata: data.metadata,
      };
    } catch (error) {
      throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean and normalize extracted text
   */
  static cleanText(text: string): string {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove page numbers and headers/footers
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/Page \d+ of \d+/gi, '')
      // Remove common PDF artifacts
      .replace(/\f/g, '\n') // Form feed characters
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\r/g, '\n')
      // Remove multiple consecutive newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Check if PDF is likely a syllabus based on content analysis
   */
  static isLikelySyllabus(text: string): boolean {
    const syllabusKeywords = [
      'syllabus',
      'course description',
      'assignments',
      'due date',
      'deadline',
      'exam',
      'midterm',
      'final',
      'reading',
      'schedule',
      'calendar',
      'grading',
      'rubric',
      'course outline',
      'learning objectives'
    ];

    const lowerText = text.toLowerCase();
    const keywordMatches = syllabusKeywords.filter(keyword => 
      lowerText.includes(keyword)
    ).length;

    // If we find at least 3 syllabus-related keywords, it's likely a syllabus
    return keywordMatches >= 3;
  }
}