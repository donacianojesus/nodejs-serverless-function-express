const OpenAI = require('openai');
import { CalendarEvent, EventType, Priority, ParsedSyllabus } from '../types/shared';
import { LLMParsedSyllabus, LLMAssignment, LLMExam, LLMActivity, LLM_SCHEMA } from '../types/llm-schema';

export interface LLMParsingResult {
  success: boolean;
  data?: ParsedSyllabus;
  error?: string;
  confidence: number;
  method: 'llm' | 'fallback';
  rawResponse?: any;
}

export class LLMParserService {
  private static openai: any = null;
  private static isInitialized = false;

  /**
   * Initialize OpenAI client
   */
  private static initializeOpenAI(): boolean {
    if (this.isInitialized) return true;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OpenAI API key not found. LLM parsing will be disabled.');
      return false;
    }

    try {
      this.openai = new OpenAI({
        apiKey: apiKey,
      });
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize OpenAI client:', error);
      return false;
    }
  }

  /**
   * Parse syllabus using LLM
   */
  static async parseSyllabusWithLLM(
    text: string,
    courseName?: string,
    courseCode?: string,
    semester?: string,
    year?: number
  ): Promise<LLMParsingResult> {
    // Check if LLM parsing is enabled
    if (process.env.ENABLE_LLM_PARSING !== 'true') {
      return {
        success: false,
        error: 'LLM parsing is disabled',
        confidence: 0,
        method: 'fallback',
      };
    }

    // Initialize OpenAI if not already done
    if (!this.initializeOpenAI()) {
      return {
        success: false,
        error: 'OpenAI client not available',
        confidence: 0,
        method: 'fallback',
      };
    }

    try {
      // Preprocess text for LLM
      const cleanedText = this.preprocessText(text);
      
      // Create the prompt
      const prompt = this.createPrompt(cleanedText, courseName, courseCode, semester, year);
      
      // Call OpenAI API
      const response = await this.callOpenAI(prompt);
      
      // Debug: Log the response length and first 200 chars
      console.log('LLM Response length:', response.length);
      console.log('LLM Response preview:', response.substring(0, 200));
      console.log('LLM Response ends with:', response.substring(response.length - 100));
      
      // Check if response looks truncated
      if (!response.trim().endsWith('}')) {
        console.warn('LLM Response appears to be truncated - not ending with }');
      }

      // Parse and validate response
      const parsedResponse = this.parseLLMResponse(response);
      
      if (!parsedResponse.success) {
        return {
          success: false,
          error: parsedResponse.error || 'Failed to parse LLM response',
          confidence: 0,
          method: 'fallback',
          rawResponse: response,
        };
      }

      // Convert LLM response to our internal format
      const calendarEvents = this.convertToCalendarEvents(parsedResponse.data!);
      
      // Create parsed syllabus object with better course info handling
      const parsedSyllabus: ParsedSyllabus = {
        courseName: parsedResponse.data!.course_info?.course_name || courseName || 'Unknown Course',
        courseCode: parsedResponse.data!.course_info?.course_code || courseCode || 'UNKNOWN',
        semester: parsedResponse.data!.course_info?.semester || semester || 'Unknown',
        year: parsedResponse.data!.course_info?.year || year || new Date().getFullYear(),
        events: calendarEvents,
        rawText: text,
        parsedAt: new Date(),
      };

      return {
        success: true,
        data: parsedSyllabus,
        confidence: parsedResponse.data!.confidence_score || 85,
        method: 'llm',
        rawResponse: response,
      };

    } catch (error) {
      console.error('LLM parsing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown LLM parsing error',
        confidence: 0,
        method: 'fallback',
      };
    }
  }

  /**
   * Preprocess text for LLM consumption
   */
  private static preprocessText(text: string): string {
    // Look for weekly schedule sections
    const weeklyPatterns = [
      /Week \d+.*?(?=Week \d+|$)/gs,
      /Here are the first.*?weeks in more detail:.*?(?=Week \d+|$)/gs,
      /Weekly Assignments.*?(?=Week \d+|$)/gs,
      /Assignment Schedule.*?(?=Week \d+|$)/gs
    ];
    
    for (const pattern of weeklyPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        const weeklyText = matches.join('\n');
        if (weeklyText.length > 100) { // Only use if substantial content
          return weeklyText
            .replace(/\s+/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .substring(0, 15000) // Increased limit for weekly schedules
            .trim();
        }
      }
    }
    
    // Look for assignment schedule patterns
    const assignmentPatterns = [
      /Week Date Assignments.*?(?=Week \d+|$)/gs,
      /Writing Assignment Due.*?(?=Week \d+|$)/gs,
      /APPELLATE BRIEF DUE.*?(?=Week \d+|$)/gs
    ];
    
    for (const pattern of assignmentPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        const assignmentText = matches.join('\n');
        if (assignmentText.length > 50) {
          return assignmentText
            .replace(/\s+/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .substring(0, 15000)
            .trim();
        }
      }
    }
    
    // Fallback to original processing
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
      // Truncate if too long (to manage token limits)
      .substring(0, 15000) // Increased limit
      .trim();
  }

  /**
   * Create the prompt for the LLM
   */
  private static createPrompt(
    text: string,
    courseName?: string,
    courseCode?: string,
    semester?: string,
    year?: number
  ): string {
    const courseInfo = courseName ? `\nCourse: ${courseName}${courseCode ? ` (${courseCode})` : ''}${semester ? ` - ${semester}` : ''}${year ? ` ${year}` : ''}` : '';

    return `You are an expert at parsing academic syllabi. Extract ALL specific assignments, readings, and exams from the syllabus text below.

CRITICAL: Extract EVERY week's assignments, not just the first week!

${courseInfo}

Syllabus Text:
${text}

EXTRACTION RULES:
1. FIND ALL weekly schedules, assignment schedules, and reading schedules
2. EXTRACT EVERY week's content (Week 1, Week 2, Week 3, etc.)
3. EXTRACT assignments with due dates
4. EXTRACT readings with page numbers and case names
5. EXTRACT exams with dates
6. EXTRACT project deadlines, presentations, quizzes, midterms, finals
7. EXTRACT discussion posts, participation requirements, attendance
8. EXTRACT lab sessions, tutorials, office hours if they have specific dates
9. IGNORE: course descriptions, policies, contact info, general materials, grading scales

Return JSON with this structure:
{
  "assignments": [
    {
      "title": "Assignment Name",
      "due_date": "2025-01-17",
      "details": "Assignment description",
      "priority": "medium"
    }
  ],
  "exams": [
    {
      "title": "Midterm Exam", 
      "date": "2025-03-15",
      "details": "In-class examination",
      "priority": "high"
    }
  ],
  "activities": [
    {
      "title": "Week 1 Monday: Introduction materials",
      "details": "Introduction materials",
      "type": "reading",
      "priority": "medium"
    }
  ],
  "course_info": {
    "course_name": "Extracted or provided course name",
    "course_code": "Extracted or provided course code", 
    "semester": "Extracted or provided semester",
    "year": 2025
  },
  "confidence_score": 90
}

CRITICAL: Extract ALL weeks, not just Week 1. Look for every "Week X:" pattern in the text.
CRITICAL: Only use specific dates if explicitly found in the text. Otherwise, put items in activities section.

JSON Response:`;
  }

  /**
   * Call OpenAI API
   */
  private static async callOpenAI(prompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at parsing academic syllabi and extracting structured information. Always return valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '10000'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.1'),
      response_format: { type: "json_object" }
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Parse and validate LLM response
   */
  private static parseLLMResponse(response: string): { success: boolean; data?: LLMParsedSyllabus; error?: string } {
    try {
      if (!response) {
        return { success: false, error: 'No content in LLM response' };
      }

      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError);
        console.error('Response that failed to parse:', response.substring(0, 500));
        return { success: false, error: 'Invalid JSON response from LLM' };
      }
      
      // Basic validation
      if (!parsed.assignments || !parsed.exams || !parsed.activities) {
        console.error('Missing required fields in LLM response:', {
          hasAssignments: !!parsed.assignments,
          hasExams: !!parsed.exams,
          hasActivities: !!parsed.activities,
          parsedKeys: Object.keys(parsed)
        });
        return { success: false, error: 'Missing required fields in LLM response' };
      }

      return { success: true, data: parsed };

    } catch (error) {
      return { 
        success: false, 
        error: `Failed to parse LLM response: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Convert LLM response to CalendarEvent format
   */
  /**
   * Convert LLM response to CalendarEvent format
   */
  private static convertToCalendarEvents(llmData: LLMParsedSyllabus): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Convert assignments
    for (const assignment of llmData.assignments) {
      try {
        // Validate the date string
        const dateStr = assignment.due_date;
        if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          console.warn(`Invalid date format for assignment "${assignment.title}": ${dateStr}`);
          continue; // Skip this assignment
        }
        
        const date = new Date(dateStr + 'T00:00:00');
        if (isNaN(date.getTime())) {
          console.warn(`Invalid date for assignment "${assignment.title}": ${dateStr}`);
          continue; // Skip this assignment
        }
        
        events.push({
          id: this.generateEventId(assignment.title, date),
          title: assignment.title,
          description: assignment.details,
          date: date,
          type: EventType.ASSIGNMENT,
          priority: this.mapPriority(assignment.priority),
          completed: false,
        });
      } catch (error) {
        console.warn(`Error processing assignment "${assignment.title}":`, error);
        continue; // Skip this assignment
      }
    }

    // Convert exams
    for (const exam of llmData.exams) {
      try {
        const dateStr = exam.date;
        if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          console.warn(`Invalid date format for exam "${exam.title}": ${dateStr}`);
          continue;
        }
        
        const date = new Date(dateStr + 'T00:00:00');
        if (isNaN(date.getTime())) {
          console.warn(`Invalid date for exam "${exam.title}": ${dateStr}`);
          continue;
        }
        
        events.push({
          id: this.generateEventId(exam.title, date),
          title: exam.title,
          description: exam.details,
          date: date,
          time: exam.time,
          type: EventType.EXAM,
          priority: this.mapPriority(exam.priority),
          completed: false,
        });
      } catch (error) {
        console.warn(`Error processing exam "${exam.title}":`, error);
        continue;
      }
    }

    // Convert activities (these don't have dates, so we'll add them with a placeholder date)
    for (const activity of llmData.activities) {
      try {
        // Use a placeholder date far in the future for activities without dates
        const placeholderDate = new Date('2099-12-31');
        
        events.push({
          id: this.generateEventId(activity.title, placeholderDate),
          title: activity.title,
          description: activity.details,
          date: placeholderDate,
          type: activity.type === 'reading' ? EventType.READING : EventType.OTHER,
          priority: this.mapPriority(activity.priority),
          completed: false,
        });
      } catch (error) {
        console.warn(`Error processing activity "${activity.title}":`, error);
        continue;
      }
    }

    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
    const events: CalendarEvent[] = [];

    // Convert assignments
    for (const assignment of llmData.assignments) {
      const dateStr = assignment.due_date + 'T00:00:00';
      const date = new Date(dateStr);
      
      events.push({
        id: this.generateEventId(assignment.title, new Date(assignment.due_date)),
        title: assignment.title,
        description: assignment.details,
        date: date,
        type: EventType.ASSIGNMENT,
        priority: this.mapPriority(assignment.priority),
        completed: false,
      });
    }

    // Convert exams
    for (const exam of llmData.exams) {
      events.push({
        id: this.generateEventId(exam.title, new Date(exam.date)),
        title: exam.title,
        description: exam.details,
        date: new Date(exam.date + 'T00:00:00'),
        time: exam.time,
        type: EventType.EXAM,
        priority: this.mapPriority(exam.priority),
        completed: false,
      });
    }

    // Convert activities (these don't have dates, so we'll add them with a placeholder date)
    for (const activity of llmData.activities) {
      // Use a placeholder date far in the future for activities without dates
      const placeholderDate = new Date('2099-12-31');
      
      events.push({
        id: this.generateEventId(activity.title, placeholderDate),
        title: activity.title,
        description: activity.details,
        date: placeholderDate,
        type: activity.type === 'reading' ? EventType.READING : EventType.OTHER,
        priority: this.mapPriority(activity.priority),
        completed: false,
      });
    }

    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Map LLM priority to our Priority enum
   */
  private static mapPriority(priority?: string): Priority {
    switch (priority?.toLowerCase()) {
      case 'urgent': return Priority.URGENT;
      case 'high': return Priority.HIGH;
      case 'medium': return Priority.MEDIUM;
      case 'low': return Priority.LOW;
      default: return Priority.MEDIUM;
    }
  }

  /**
   * Generate unique event ID
   */
  private static generateEventId(title: string, date: Date): string {
    const titleHash = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    // Handle invalid dates gracefully
    let dateStr: string;
    try {
      if (isNaN(date.getTime())) {
        // If date is invalid, use a fallback
        dateStr = 'invalid-date';
      } else {
        dateStr = date.toISOString().split('T')[0];
      }
    } catch (error) {
      dateStr = 'invalid-date';
    }
    
    return `${titleHash}-${dateStr}`;
  }

  /**
   * Get LLM service status
   */
  static getStatus(): { available: boolean; model?: string; error?: string } {
    if (!this.initializeOpenAI()) {
      return { 
        available: false, 
        error: 'OpenAI API key not configured or invalid' 
      };
    }

    return {
      available: true,
      model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
    };
  }
}