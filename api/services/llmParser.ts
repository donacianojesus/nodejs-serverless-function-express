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

ABSOLUTE HIERARCHICAL RULE: When you see ANY date header (like "February 7", "February 24", "March 21") followed by bullet points, ALL those bullet points belong to that date. You MUST scan backwards from every bullet point to find the nearest date header above it.

CRITICAL: Extract EVERY week's assignments, not just the first week!

ABSOLUTE PRIORITY: If you see ANY content with a specific date (any month/day combination), extract it as an assignment/reading with that date. NEVER put dated content in "activities" - only put truly undated content in activities. This applies to ALL syllabus types and formats.

CRITICAL HIERARCHY RULE: When you see a date followed by bullet points on separate lines, ALL those bullet points belong to that date. For example: "January 24" followed by "• Read: [content]" and "• Optional Listening: [content]" means BOTH items are for January 24. NEVER extract bullet points as separate undated items when they appear under a date header.

ABSOLUTE HIERARCHICAL STRUCTURE RULE: If you see ANY date (like "February 7", "February 24", "March 21") followed by multiple bullet points, ALL those bullet points belong to that date. This includes "• Optional Listening:", "• Complete:", "• Read:", etc. Look backwards in the text for the nearest date header above any bullet point.

UNIVERSAL RULE FOR OPTIONAL TASKS: If you see "• Optional Listening:" or "• Optional Reading:" or "• Optional Watching:" in the text, ALWAYS extract it as a reading activity. Check if it appears under a specific date header - if it does, extract it with that date. If it appears in a general section without a specific date, extract it as an activity without a date. Never ignore optional tasks - they are always valuable content to extract.

${courseInfo}

Syllabus Text:
${text}

EXTRACTION RULES:
1. FIND ALL weekly schedules, assignment schedules, and reading schedules
2. EXTRACT EVERY week's content (Week 1, Week 2, Week 3, etc.)
3. CRITICAL: When you see a date header (like "February 7", "February 24", "March 21") followed by bullet points, ALL bullet points belong to that date
4. CRITICAL: Look backwards from any bullet point to find the nearest date header above it
5. EXTRACT assignments with due dates
6. EXTRACT readings with page numbers and case names
7. EXTRACT exams with dates
8. EXTRACT project deadlines, presentations, quizzes, midterms, finals
9. EXTRACT discussion posts, participation requirements, attendance
10. EXTRACT lab sessions, tutorials, office hours if they have specific dates
11. IGNORE: course descriptions, policies, contact info, general materials, grading scales

SPECIFIC PATTERNS TO FIND:
- "Week X Readings:" → Extract all readings for that week
- "Week X:" → Extract all assignments for that week
- "Week X [Date]:" → Extract as single event with that specific date
- "Week X [Date]: [Content]" → Extract as single event for that date
- "Assignment Due:" → Extract as assignment
- "Exam:" or "Midterm" or "Final" → Extract as exam
- "Read:" → Extract as reading
- "Pages XX-XX" → Extract with page numbers
- "Case Name v. Case Name" → Extract case names
- "Project Due:" → Extract as assignment
- "Presentation:" → Extract as assignment
- "Quiz:" → Extract as exam
- "Discussion Post:" → Extract as assignment
- "Lab:" or "Tutorial:" → Extract if has specific date
- "Deadline:" → Extract as assignment
- "Submit:" → Extract as assignment
- "Due Date:" → Extract as assignment
- "Final Exam:" → Extract as exam
- "Midterm Exam:" → Extract as exam
- "Writing Assignment Due:" → Extract as assignment
- "APPELLATE BRIEF DUE" → Extract as assignment
- "ORAL ARGUMENTS" → Extract as exam
- "Research Report" → Extract as assignment
- "Complete Motion" → Extract as assignment
- "Partial Motion" → Extract as assignment
- "Podcast" → Extract as reading/homework activity WITH SPECIFIC DATE if mentioned
- "Course evaluation" → Extract as assignment WITH SPECIFIC DATE if mentioned
- "Online course evaluation" → Extract as assignment WITH SPECIFIC DATE if mentioned
- "Optional Listening:" → Extract as reading activity WITH SPECIFIC DATE if mentioned
- "Complete:" → Extract as assignment WITH SPECIFIC DATE if mentioned

READING EXTRACTION RULES:
- ALWAYS include the week number and day (e.g., "Week 1 Monday:", "Week 2 Wednesday:")
- ALWAYS include page numbers when available (e.g., "Pages 38-54")
- ALWAYS include case names when available (e.g., "Hawkins v. McGee")
- Use descriptive titles like "Week 1 Monday: Introduction materials (Hawkins v. McGee)" instead of just "Reading"
- If only page numbers are given, use "Week X Day: Pages XX-XX"
- If only case names are given, use "Week X Day: [Case Name]"
- Include chapter numbers when available (e.g., "Chapter 3: Pages 45-67")
- Include article titles when available (e.g., "Article: 'Contract Formation' Pages 23-45")
- IMPORTANT: When you see "Week X [Date] • Read: [Content]", extract as "Week X Readings: [Content]" with the specific date
- IMPORTANT: Include the full reading description, not just "Week X Readings"
- IMPORTANT: Extract specific book titles, chapter numbers, and page ranges
- CRITICAL: Do NOT use generic titles like "Week 1 Readings" - extract the actual reading content
- CRITICAL: When you see "Week 1 January 17 • Read: The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206", extract as separate reading assignments for January 17, 2025
- CRITICAL: When you see "Week 2 January 24 • Read: Syllabus and Assignment Schedule • Read: Handbook: Chapters 29-32, pages 207-44", extract as separate reading assignments for January 24, 2025
- CRITICAL: Group multiple readings/assignments by their actual calendar date
- CRITICAL: For January 17, 2025, extract: "The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206" AND "Sample Motions, pages 245-76" as separate assignments
- CRITICAL: For January 24, 2025, extract: "Syllabus and Assignment Schedule" AND "Handbook: Chapters 29-32, pages 207-44" AND "Bring draft of Partial Motion or Opposition to class (2 printed copies)" as separate assignments
- CRITICAL: Always include the specific book names, chapter numbers, and page ranges in the title

DATE EXTRACTION RULES:
- Look for explicit dates in formats: "MM/DD/YYYY", "MM-DD-YYYY", "Month DD, YYYY", "DD Month YYYY"
- Look for relative dates: "Due Week 5", "Due March 15th", "Due by Friday"
- Look for semester dates: "Fall 2024", "Spring 2025", "Fall Semester 2024"
- If you see "Week X" with a specific date, use that date
- If you see "Due: [date]", extract that date
- If you see "Deadline: [date]", extract that date
- If you see "Submit by: [date]", extract that date
- For weekly readings without specific dates, put in activities section
- For Spring 2025 semester, ensure dates are in 2025, not 2024
- Look for assignment schedule tables with specific dates
- CRITICAL: Look for specific dates in the assignment schedule section
- For Spring 2025: Week 1 = January 17, Week 2 = January 24, Week 3 = January 31, Week 4 = February 7, Week 5 = February 14, Week 6 = February 21, Week 7 = February 28, Week 8 = March 7, Week 9 = March 14, Week 10 = March 21, Week 11 = March 28, Week 12 = April 4
- If an assignment has a specific due date mentioned, extract that exact date
- Look for patterns like "January 17", "February 7", "March 31", "April 3-4"
- CRITICAL: When you see "Week X [Date]:" format (e.g., "Week 1 January 17:", "Week 4 February 7:"), extract as a SINGLE event for that specific date
- CRITICAL: Do NOT duplicate dates - if you see "Week 1 January 17: Podcasts 1, 2, and 3", create ONE event for January 17, 2025
- CRITICAL: For "Week X [Date]: [Content]" patterns, extract the content as the event description and use the specific date provided
CRITICAL: "Week 1 January 17: Podcasts 1, 2, and 3" should create ONE event with:
  - title: "Podcasts 1, 2, and 3"
  - date: "2025-01-17" (January 17, 2025)
  - type: "reading"
  - description: "Optional Listening: Podcasts 1, 2, and 3 at jillbarton.net. The password is Kagan!"
CRITICAL: "Week 10 March 21: Online course evaluation" should create ONE event with:
  - title: "Online course evaluation"
  - date: "2025-03-21" (March 21, 2025)
  - type: "assignment"
  - description: "Complete: Online course evaluation"

CRITICAL WEEK PATTERN HANDLING:
- When you see "Week X [Date]:" followed by content, extract the content as an assignment/reading for that specific date
- "Week 1 January 17:" followed by "• Read: [content]" → Extract as assignment for January 17, 2025
- "Week 7 February 24:" followed by "• Optional Listening: Podcasts 7, 8, and 9" → Extract as reading for February 24, 2025
- "March 21 • Complete: Online course evaluation" → Extract as assignment for March 21, 2025
- NEVER put week-based content in "activities" - always extract with the specific date mentioned

UNIVERSAL PATTERN RECOGNITION (APPLIES TO ALL SYLLABI):
- "Week X [Date]: [Content]" → Extract as ONE event with that specific date
- "[Date] • [Activity Type]: [Content]" → Extract as assignment/reading for that specific date
- "• Optional Listening: [Content]" → Extract as reading with the date from the week/section
- "• Complete: [Content]" → Extract as assignment with the date from the week/section
- "• Read: [Content]" → Extract as reading with the date from the week/section
- "• Watch: [Content]" → Extract as reading with the date from the week/section
- "• Review: [Content]" → Extract as reading with the date from the week/section
- "• Study: [Content]" → Extract as reading with the date from the week/section

CRITICAL WEEKLY STRUCTURE UNDERSTANDING:
- When you see a weekly schedule with a date header, ALL content listed under that date belongs to that date
- If you see "February 7" followed by bullet points including "• Optional Listening:", extract the optional listening for February 7
- If you see "March 21" followed by bullet points including "• Complete:", extract the complete item for March 21
- The date applies to ALL bullet points listed under it in the weekly schedule

CRITICAL HIERARCHICAL STRUCTURE RECOGNITION:
- When you see a date (like "January 24", "February 7", "March 21") followed by multiple bullet points on separate lines, ALL those bullet points belong to that date
- Example: If you see "January 24" followed by "• Read: [content]" and "• Optional Listening: [content]", BOTH items are for January 24
- Example: If you see "February 7" followed by "• Read: [content]" and "• Optional Listening: [content]", BOTH items are for February 7
- NEVER extract bullet points as separate undated items when they appear under a date header

UNIVERSAL EXAMPLES (ALL SYLLABUS TYPES):
- "Week 1 January 17: Introduction materials" → Extract as ONE event for January 17, type: "reading"
- "Week 4 February 7: Midterm preparation" → Extract as ONE event for February 7, type: "assignment"
- "February 24 • Optional Reading: Chapter 5" → Extract as reading for February 24, type: "reading"
- "March 21 • Complete: Course evaluation" → Extract as assignment for March 21, type: "assignment"
- "January 17 • Watch: Lecture videos" → Extract as reading for January 17, type: "reading"

WEEKLY STRUCTURE EXAMPLES:
- If you see "February 7" followed by multiple bullet points including "• Optional Listening: Podcasts 4, 5, and 6", extract "Podcasts 4, 5, and 6" as reading for February 7, 2025
- If you see "March 21" followed by bullet points including "• Complete: Online course evaluation", extract "Online course evaluation" as assignment for March 21, 2025
- The date header applies to ALL content listed under it in the weekly schedule

SPECIFIC HIERARCHICAL EXAMPLES:
- "January 24" followed by "• Read: Syllabus and Assignment Schedule" and "• Optional Listening: Podcasts 1, 2, and 3" → Extract BOTH items for January 24
- "February 7" followed by "• Read: Handbook: Chapter 39" and "• Optional Listening: Podcasts 4, 5, and 6" → Extract BOTH items for February 7
- "February 24" followed by "• Read: Handbook: Chapter 33" and "• Optional Listening: Podcasts 7, 8, and 9" → Extract BOTH items for February 24
- NEVER put "Optional Listening" items in activities when they appear under a date header

UNIVERSAL OPTIONAL TASK EXAMPLES:
- If you see "• Optional Listening: [content]" under a date header like "January 24", extract it as reading for January 24
- If you see "• Optional Reading: [content]" under a date header like "February 7", extract it as reading for February 7
- If you see "• Optional Listening: [content]" in a general section without a specific date, extract it as an activity without a date
- ALWAYS extract optional tasks - never ignore them. The key is checking if the optional task appears under a specific date header or in a general section

CRITICAL DATE LOOKUP RULE: When you encounter ANY bullet point (• Optional Listening:, • Complete:, • Read:, etc.), ALWAYS look backwards in the text for the nearest date header above it. That date applies to the bullet point content.

MANDATORY HIERARCHICAL PROCESSING: For EVERY bullet point you encounter, you MUST scan backwards through the text to find the most recent date header (like "February 7", "February 24", "March 21"). That date header applies to ALL bullet points that follow it until the next date header appears.

ABSOLUTE UNIVERSAL RULE: If you see ANY specific date (January, February, March, April, etc.) followed by ANY content (• Optional, • Complete, • Read, • Watch, etc.), extract it as an assignment/reading with that specific date. NEVER put dated content in "activities".

CRITICAL DESCRIPTION RULES:
- Keep descriptions GENERAL and UNIVERSAL - do not include specific passwords, URLs, or course-specific details
- For "Optional Listening: Podcasts X, Y, and Z" → Description should be "Optional Listening: Podcasts X, Y, and Z" (without specific website details)
- For "Complete: Course evaluation" → Description should be "Complete: Course evaluation" (without specific instructions)
- Extract the core activity, not administrative details

UNIVERSAL DATE HANDLING RULES (ALL SYLLABI):
- ALWAYS use the EXACT date mentioned in any format (Week X [Date]:, [Date] •, etc.)
- DO NOT subtract one day from any date - use the date as written
- NEVER use date arithmetic - if the syllabus says "January 17", use "January 17"
- NEVER convert dates to the day before - this is a critical error
- If you see "Week X [Date]:" format, use the exact date provided
- If you see "[Date] •" format, use the exact date provided
- If you see "[Month] [Day]" format, use the exact date provided
- For Spring 2025 syllabi: All dates should be in 2025
- For Fall 2024 syllabi: All dates should be in 2024
- For Summer 2025 syllabi: All dates should be in 2025

ASSIGNMENT SCHEDULE EXTRACTION:
- Look for "ASSIGNMENT SCHEDULE" or "Reading and Assignment Schedule" sections
- Extract specific assignments with their due dates
- Look for patterns like "Writing Assignment Due: [assignment name]"
- Look for patterns like "APPELLATE BRIEF DUE ON TWEN BY 8:00 P.M."
- Look for patterns like "ORAL ARGUMENTS" with specific dates
- Extract the actual assignment names, not the full syllabus text

Return JSON with this structure:
{
  "assignments": [
    {
      "title": "The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206",
      "due_date": "2025-01-17",
      "details": "Read: The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206",
      "priority": "medium"
    }
  ],
  "exams": [
    {
      "title": "Midterm Exam", 
      "date": "2025-03-15",
      "details": "In-class examination covering chapters 1-10",
      "priority": "high"
    }
  ],
  "activities": [
    {
      "title": "Week 1 Monday: Introduction materials",
      "details": "Introduction materials (Hawkins v. McGee) & Home Building v. Blaisdell",
      "type": "reading",
      "priority": "medium"
    }
  ],
  "course_info": {
    "course_name": "Extracted or provided course name",
    "course_code": "Extracted or provided course code", 
    "semester": "Extracted or provided semester",
    "year": 2024
  },
  "confidence_score": 90
}

CRITICAL: Extract ALL weeks, not just Week 1. Look for every "Week X:" pattern in the text.
CRITICAL: If you see ANY specific date (any month/day combination), extract the content for that date as an assignment/reading. NEVER put dated content in activities.
CRITICAL: Activities should ONLY contain content with NO specific dates mentioned anywhere.
CRITICAL: ALWAYS extract optional tasks (• Optional Listening:, • Optional Reading:, • Optional Watching:) - never ignore them.
CRITICAL: For EVERY bullet point, scan backwards to find the nearest date header - that date applies to the bullet point.
CRITICAL: These rules apply to ALL syllabus types - law school, undergraduate, graduate, etc.

FINAL UNIVERSAL RULE: For optional tasks like "• Optional Listening:" or "• Optional Reading:", ALWAYS extract them. Check if they appear under a specific date header - if they do, extract them with that date. If they appear in a general section without a specific date, extract them as activities without a date. Never ignore optional tasks - they are always valuable content to extract regardless of syllabus type.

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

      // Validate date formats - be more flexible with ambiguous dates
      const validateDate = (dateStr: any) => {
        // Handle null/undefined dates
        if (!dateStr || dateStr === null || dateStr === undefined) {
          return false; // We'll filter these out later
        }
        
        // Convert to string if it's not already
        const dateString = String(dateStr);
        
        // Skip validation for placeholder dates (XX-XX format)
        if (dateString.includes('XX') || dateString.includes('TBD') || dateString.includes('TBA')) {
          return false; // We'll filter these out later
        }
        const date = new Date(dateString);
        return !isNaN(date.getTime()) && dateString.match(/^\d{4}-\d{2}-\d{2}$/);
      };

      // Collect events with invalid dates to add to activities
      const invalidAssignments: any[] = [];
      const invalidExams: any[] = [];

      // Filter assignments - keep valid ones, collect invalid ones
      parsed.assignments = parsed.assignments.filter((assignment: any) => {
        if (!validateDate(assignment.due_date)) {
          console.log(`Moving assignment with invalid date to activities: ${assignment.due_date}, Title: ${assignment.title}`);
          invalidAssignments.push({
            title: assignment.title,
            details: assignment.details || `Due date: ${assignment.due_date}`,
            type: 'other',
            priority: assignment.priority || 'medium'
          });
          return false;
        }
        return true;
      });

      // Filter exams - keep valid ones, collect invalid ones
      parsed.exams = parsed.exams.filter((exam: any) => {
        if (!validateDate(exam.date)) {
          console.log(`Moving exam with invalid date to activities: ${exam.date}`);
          invalidExams.push({
            title: exam.title,
            details: exam.details || `Exam date: ${exam.date}`,
            type: 'other',
            priority: exam.priority || 'medium'
          });
          return false;
        }
        return true;
      });

      // Add invalid events to activities
      parsed.activities = [...(parsed.activities || []), ...invalidAssignments, ...invalidExams];

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
  private static convertToCalendarEvents(llmData: LLMParsedSyllabus): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    // Convert assignments
    for (const assignment of llmData.assignments) {
      // Parse date in local timezone to avoid day-shifting issues
      const date = new Date(assignment.due_date + 'T12:00:00');
      console.log(`Assignment: ${assignment.title}, Original date: ${assignment.due_date}, Processed date: ${date.toISOString()}, Local date: ${date.toLocaleDateString()}`);
      
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
      // Parse date in local timezone to avoid day-shifting issues
      const date = new Date(exam.date + 'T12:00:00');
      events.push({
        id: this.generateEventId(exam.title, new Date(exam.date)),
        title: exam.title,
        description: exam.details,
        date: date,
        time: exam.time,
        type: EventType.EXAM,
        priority: this.mapPriority(exam.priority),
        completed: false,
      });
    }

    // Convert activities (these don't have dates, so we'll add them with a placeholder date)
    // Only include reading assignments and academic activities, filter out administrative items
    for (const activity of llmData.activities) {
      // Skip administrative items
      const title = activity.title.toLowerCase();
      const description = (activity.details || '').toLowerCase();
      
      // Filter out administrative items
      if (title.includes('office hours') || 
          title.includes('email') || 
          title.includes('class time') || 
          title.includes('conference') ||
          title.includes('blackboard') ||
          title.includes('twen') ||
          title.includes('absence') ||
          title.includes('policy') ||
          description.includes('office hours') ||
          description.includes('email') ||
          description.includes('class time')) {
        continue; // Skip this activity
      }
      
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
    const dateStr = date.toISOString().split('T')[0];
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