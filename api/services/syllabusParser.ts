import { CalendarEvent, EventType, Priority, ParsedSyllabus } from '../types/shared';
import { DateParserService, DateParseResult } from '../utils/dateParser';
import { LLMParserService, LLMParsingResult } from './llmParser';

export interface ParsingResult {
  success: boolean;
  data?: ParsedSyllabus;
  error?: string;
  confidence: number; // 0-100, how confident we are in the parsing
  method?: 'llm' | 'regex' | 'fallback'; // Which parsing method was used
}

export class SyllabusParserService {
  private static readonly ASSIGNMENT_PATTERNS = [
    // Assignment patterns
    /assignment\s*#?\s*(\d+)/gi,
    /homework\s*#?\s*(\d+)/gi,
    /hw\s*#?\s*(\d+)/gi,
    /problem\s*set\s*#?\s*(\d+)/gi,
    /ps\s*#?\s*(\d+)/gi,
    /paper\s*#?\s*(\d+)/gi,
    /essay\s*#?\s*(\d+)/gi,
    /project\s*#?\s*(\d+)/gi,
    /memo\s*#?\s*(\d+)/gi,
    /brief\s*#?\s*(\d+)/gi,
  ];

  private static readonly EXAM_PATTERNS = [
    /midterm\s*(exam)?/gi,
    /final\s*(exam)?/gi,
    /exam\s*#?\s*(\d+)/gi,
    /test\s*#?\s*(\d+)/gi,
    /quiz\s*#?\s*(\d+)/gi,
  ];

  private static readonly READING_PATTERNS = [
    /read\s+(chapter|ch\.?)\s*(\d+)/gi,
    /reading\s*#?\s*(\d+)/gi,
    /case\s*#?\s*(\d+)/gi,
    /article\s*#?\s*(\d+)/gi,
    /textbook\s*#?\s*(\d+)/gi,
  ];

  private static readonly DEADLINE_PATTERNS = [
    /due\s+(by|on|at)/gi,
    /deadline/gi,
    /submit/gi,
    /turn\s+in/gi,
    /hand\s+in/gi,
  ];

  /**
   * Parse syllabus text and extract calendar events
   * Tries LLM parsing first, falls back to regex parsing if LLM fails
   */
  static async parseSyllabus(
    text: string,
    courseName?: string,
    courseCode?: string,
    semester?: string,
    year?: number
  ): Promise<ParsingResult> {
    try {
      // Try LLM parsing first
      const llmResult = await LLMParserService.parseSyllabusWithLLM(
        text,
        courseName,
        courseCode,
        semester,
        year
      );

      if (llmResult.success && llmResult.data) {
        return {
          success: true,
          data: llmResult.data,
          confidence: llmResult.confidence,
          method: 'llm',
        };
      }

      // Fallback to regex parsing
      console.log('LLM parsing failed, falling back to regex parsing:', llmResult.error);
      return this.parseSyllabusWithRegex(text, courseName, courseCode, semester, year);

    } catch (error) {
      console.error('Syllabus parsing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
        confidence: 0,
        method: 'fallback',
      };
    }
  }

  /**
   * Parse syllabus using regex patterns (fallback method)
   */
  private static async parseSyllabusWithRegex(
    text: string,
    courseName?: string,
    courseCode?: string,
    semester?: string,
    year?: number
  ): Promise<ParsingResult> {
    try {
      // Clean and normalize text
      const cleanText = this.cleanText(text);
      
      // Extract course information if not provided
      const courseInfo = this.extractCourseInfo(cleanText, courseName, courseCode, semester, year);
      
      // Extract all dates from the text
      const dateResults = DateParserService.extractDates(cleanText);
      
      // Extract events by analyzing text around dates
      const events = this.extractEvents(cleanText, dateResults);
      
      // Calculate parsing confidence
      const confidence = this.calculateConfidence(events, dateResults, cleanText);
      
      // Create parsed syllabus object
      const parsedSyllabus: ParsedSyllabus = {
        courseName: courseInfo.courseName,
        courseCode: courseInfo.courseCode,
        semester: courseInfo.semester,
        year: courseInfo.year,
        events,
        rawText: text,
        parsedAt: new Date(),
      };

      return {
        success: true,
        data: parsedSyllabus,
        confidence,
        method: 'regex',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown regex parsing error',
        confidence: 0,
        method: 'fallback',
      };
    }
  }

  /**
   * Clean and normalize text for parsing
   */
  private static cleanText(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove page numbers and headers
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/Page \d+ of \d+/gi, '')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove excessive newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Extract course information from text
   */
  private static extractCourseInfo(
    text: string,
    courseName?: string,
    courseCode?: string,
    semester?: string,
    year?: number
  ) {
    // If course info is provided, use it
    if (courseName && courseCode) {
      return { courseName, courseCode, semester, year };
    }

    // Try to extract from text
    const courseNameMatch = text.match(/(?:course\s+name|title):\s*([^\n]+)/i);
    const courseCodeMatch = text.match(/(?:course\s+code|number):\s*([A-Z0-9\s]+)/i);
    const semesterMatch = text.match(/(?:semester|term):\s*([^\n]+)/i);
    const yearMatch = text.match(/(?:year|academic\s+year):\s*(\d{4})/i);

    return {
      courseName: courseName || courseNameMatch?.[1]?.trim() || 'Unknown Course',
      courseCode: courseCode || courseCodeMatch?.[1]?.trim() || 'UNKNOWN',
      semester: semester || semesterMatch?.[1]?.trim() || 'Unknown',
      year: year || parseInt(yearMatch?.[1] || new Date().getFullYear().toString()),
    };
  }

  /**
   * Extract events from text by analyzing content around dates
   */
  private static extractEvents(text: string, dateResults: DateParseResult[]): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const lines = text.split('\n');

    for (const dateResult of dateResults) {
      if (!dateResult.date) continue;

      // Find lines containing this date
      const relevantLines = lines.filter(line => 
        line.toLowerCase().includes(dateResult.originalText.toLowerCase())
      );

      for (const line of relevantLines) {
        const event = this.parseEventFromLine(line, dateResult);
        if (event) {
          events.push(event);
        }
      }
    }

    // Remove duplicates and sort by date
    return this.deduplicateEvents(events).sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Parse a single event from a line of text
   */
  private static parseEventFromLine(line: string, dateResult: DateParseResult): CalendarEvent | null {
    if (!dateResult.date) return null;

    const cleanLine = line.trim();
    const lowerLine = cleanLine.toLowerCase();

    // Determine event type
    let eventType = EventType.OTHER;
    let title = cleanLine;
    let priority = Priority.MEDIUM;

    // Check for assignment patterns
    if (this.ASSIGNMENT_PATTERNS.some(pattern => pattern.test(lowerLine))) {
      eventType = EventType.ASSIGNMENT;
      priority = Priority.HIGH;
    }
    // Check for exam patterns
    else if (this.EXAM_PATTERNS.some(pattern => pattern.test(lowerLine))) {
      eventType = EventType.EXAM;
      priority = Priority.URGENT;
    }
    // Check for reading patterns
    else if (this.READING_PATTERNS.some(pattern => pattern.test(lowerLine))) {
      eventType = EventType.READING;
      priority = Priority.MEDIUM;
    }
    // Check for deadline patterns
    else if (this.DEADLINE_PATTERNS.some(pattern => pattern.test(lowerLine))) {
      eventType = EventType.DEADLINE;
      priority = Priority.HIGH;
    }

    // Clean up title
    title = this.cleanEventTitle(cleanLine);

    return {
      id: this.generateEventId(title, dateResult.date),
      title,
      description: cleanLine,
      date: dateResult.date,
      type: eventType,
      priority,
      completed: false,
    };
  }

  /**
   * Clean up event title
   */
  private static cleanEventTitle(title: string): string {
    return title
      // Remove common prefixes
      .replace(/^(assignment|homework|hw|exam|test|quiz|reading|due|deadline):\s*/i, '')
      // Remove date information
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '')
      .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, '')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate unique event ID
   */
  private static generateEventId(title: string, date: Date): string {
    const titleHash = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const dateStr = date.toISOString().split('T')[0];
    return `${titleHash}-${dateStr}`;
  }

  /**
   * Remove duplicate events
   */
  private static deduplicateEvents(events: CalendarEvent[]): CalendarEvent[] {
    const seen = new Set<string>();
    return events.filter(event => {
      if (seen.has(event.id)) {
        return false;
      }
      seen.add(event.id);
      return true;
    });
  }

  /**
   * Calculate parsing confidence score
   */
  private static calculateConfidence(
    events: CalendarEvent[],
    dateResults: DateParseResult[],
    text: string
  ): number {
    let score = 0;
    let maxScore = 100;

    // Base score for finding dates
    const validDates = dateResults.filter(d => d.date).length;
    score += Math.min(validDates * 10, 30);

    // Score for finding events
    score += Math.min(events.length * 5, 25);

    // Score for high-confidence dates
    const highConfidenceDates = dateResults.filter(d => d.confidence === 'high').length;
    score += Math.min(highConfidenceDates * 5, 20);

    // Score for finding different event types
    const uniqueTypes = new Set(events.map(e => e.type)).size;
    score += uniqueTypes * 5;

    // Penalty for very short text
    if (text.length < 500) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }
}