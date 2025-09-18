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

SPECIFIC PATTERNS TO FIND:
- "Week X Readings:" → Extract all readings for that week
- "Week X:" → Extract all assignments for that week
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

ASSIGNMENT SCHEDULE EXTRACTION:
- Look for "ASSIGNMENT SCHEDULE" or "Reading and Assignment Schedule" sections
- Extract specific assignments with their due dates
- Look for patterns like "Writing Assignment Due: [assignment name]"
- Look for patterns like "APPELLATE BRIEF DUE ON TWEN BY 8:00 P.M."
- Look for patterns like "ORAL ARGUMENTS" with specific dates
- Extract the actual assignment names, not the full syllabus text

EXAMPLES:
If you see "Week 1 Readings: M: Introduction materials (Hawkins v. McGee) & Home Building v. Blaisdell W: Door Dash, Inc. v. City of New York; Pages 38-54", extract:
- "Week 1 Monday: Introduction materials (Hawkins v. McGee) & Home Building v. Blaisdell" (no specific date - goes to activities)
- "Week 1 Wednesday: Door Dash, Inc. v. City of New York; Pages 38-54" (no specific date - goes to activities)

If you see "Week 2: Readings: M: Pages 66-90 W: Pages 91-101; 119-138", extract:
- "Week 2 Monday: Pages 66-90" (no specific date - goes to activities)
- "Week 2 Wednesday: Pages 91-101; 119-138" (no specific date - goes to activities)

If you see "Writing Assignment Due: Research Report", extract:
- "Research Report" as assignment

If you see "Assignment Due: March 15, 2024 - Research Paper", extract:
- "Research Paper" as assignment with date "2024-03-15"

If you see "Final Exam: December 18, 2024 at 2:00 PM", extract:
- "Final Exam" as exam with date "2024-12-18"

If you see "Project Deadline: Week 8 (March 20)", extract:
- "Project" as assignment with date "2024-03-20"

If you see "Discussion Post Due: Every Friday by 11:59 PM", extract:
- "Discussion Post" as assignment (weekly - goes to activities)

If you see "Quiz: Chapter 5 - Due March 10th", extract:
- "Quiz: Chapter 5" as exam with date "2024-03-10"

If you see "Presentation: Group Project - April 5, 2024", extract:
- "Group Project Presentation" as assignment with date "2024-04-05"

If you see "Week 1 January 17 • Read: The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206; Sample Motions, pages 245-76", extract:
- "The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206" with due_date: "2025-01-17"
- "Sample Motions, pages 245-76" with due_date: "2025-01-17"

If you see "Week 2 January 24 • Read: Syllabus and Assignment Schedule • Read: Handbook: Chapters 29-32, pages 207-44 • Bring draft of Partial Motion or Opposition to class (2 printed copies)", extract:
- "Syllabus and Assignment Schedule" with due_date: "2025-01-24"
- "Handbook: Chapters 29-32, pages 207-44" with due_date: "2025-01-24"
- "Bring draft of Partial Motion or Opposition to class (2 printed copies)" with due_date: "2025-01-24"

If you see "Week 4 February 7 • Read: Handbook: Chapter 39, pages 347-61", extract:
- "Handbook: Chapter 39, pages 347-61" with due_date: "2025-02-07"

If you see "Week 5 February 14 • Writing Assignment Due: Complete Motion or Opposition", extract:
- "Complete Motion or Opposition" as assignment with due_date: "2025-02-14"

If you see "APPELLATE BRIEF DUE ON TWEN BY 8:00 P.M.", extract:
- "Appellate Brief Due" as assignment with due_date: "2025-03-31"

If you see "April 3-4 ORAL ARGUMENTS", extract:
- "Oral Arguments" as exam with date: "2025-04-03"

If you see "Complete: Oral arguments (in class)", extract:
- "Oral Arguments" as exam with date: "2025-04-03"

If you see "Complete online course evaluation on [date]", extract:
- "Online Course Evaluation" as assignment with due_date: "[date]"

If you see "Week X [Day]: [Assignment]", extract:
- "[Assignment]" as assignment with due_date based on week and day (e.g., "Week 1 Monday:" → first Monday of semester)

If you cannot determine the exact date for "Week X [Day]: [Assignment]", extract:
- "Week X [Day]: [Assignment]" as activity (preserve the week information in the title)

If you see assignments with phrases like "submit on TWEN", "submit online", "submit by [general time]" without specific dates, extract:
- "[Assignment Name] (Online Submission)" as assignment (no specific date - goes to activities)

If you see assignments with phrases like "bring to class", "due in class", "class on [date]", "complete on [date]", "finish by [date]", extract:
- "[Assignment Name]" as assignment with the specific due_date

If you see assignments with phrases like "complete [something] on [date]", "finish [something] by [date]", extract:
- "[Assignment Name]" as assignment with the specific due_date

If you see "Writing Assignment Due: Complete Motion or Opposition", extract:
- "Complete Motion or Opposition" as assignment (no specific date - goes to activities)

If you see "APPELLATE BRIEF DUE ON TWEN BY 8:00 P.M.", extract:
- "Appellate Brief" as assignment (no specific date - goes to activities)

If you see "ORAL ARGUMENTS April 3-4", extract:
- "Oral Arguments" as exam with dates "2025-04-03" and "2025-04-04"

If you see "Writing Assignment Due: Research Report", extract:
- "Research Report" as assignment (no specific date - goes to activities)

COURSE INFORMATION EXTRACTION:
- Look for course title, course code, semester, and year in the text
- If not found in text, use the provided course information
- Extract from patterns like "Course Title:", "Course Code:", "Semester:", "Year:"
- Look for headers like "CONSTITUTIONAL LAW", "LAW 101", "Fall 2024", etc.
- Extract course name from the main title or header of the document
- Look for patterns like "CONSTITUTIONAL LAW", "CONTRACTS", "TORTS", "CRIMINAL LAW"
- Look for course codes like "LAW 101", "LAW 201", "CONST 101", etc.
- Look for semester patterns like "Fall 2024", "Spring 2025", "Fall Semester 2024"
- If you find "CONSTITUTIONAL LAW" or similar, use that as the course name
- If you find "Fall 2024" or similar, extract semester and year from that

SPECIFIC EXTRACTION EXAMPLES:
- If you see "CONSTITUTIONAL LAW" → course_name: "Constitutional Law"
- If you see "CONTRACTS" → course_name: "Contracts" 
- If you see "LAW 101" → course_code: "LAW 101"
- If you see "Fall 2024" → semester: "Fall", year: 2024
- If you see "Fall Semester 2024" → semester: "Fall", year: 2024
- If you see "Dawson College" or "Dawson" → this might be the institution, not course name

CRITICAL: Extract actual course information from the syllabus text, not placeholder text like "Extracted or provided course name"
CRITICAL: Extract specific assignment titles, not the entire syllabus text
CRITICAL: For Spring 2025 semester, dates should be in 2025, not 2024 or other years
CRITICAL: Look for assignment schedules, reading schedules, and due dates in the text
CRITICAL: Do not use the full syllabus text as event titles - extract specific assignment names only
CRITICAL: When you see "Week 1 January 17" extract the date as "2025-01-17"
CRITICAL: When you see "Week 2 January 24" extract the date as "2025-01-24"
CRITICAL: When you see "Week 4 February 7" extract the date as "2025-02-07"
CRITICAL: When you see "Week 5 February 14" extract the date as "2025-02-14"
CRITICAL: When you see "Week 6 Tuesday, February 18" extract the date as "2025-02-18"
CRITICAL: When you see "Week 7 Monday, February 24" extract the date as "2025-02-24"
CRITICAL: When you see "Week 8 March 7" extract the date as "2025-03-07"
CRITICAL: When you see "Week 10 March 21" extract the date as "2025-03-21"
CRITICAL: Extract dates in any format: "Week X [Month] [Day]", "[Day], [Month] [Day]", "[Month] [Day]-[Day]", "[Month] [Day]", "Week X [Day]:", "Week X [Day] [Month]"
CRITICAL: Convert all dates to YYYY-MM-DD format using the course year (2025 for Spring 2025, 2024 for Fall 2024)
CRITICAL: For date ranges like "April 3-4", use the first date (2025-04-03)
CRITICAL: For "Week X [Day]:" format, extract the day and convert to proper date based on course semester
CRITICAL: For readings with specific dates, put them in assignments/exams with due_date, NOT in activities
CRITICAL: Only put items without specific dates in the activities section
CRITICAL: Extract ALL assignments from the entire syllabus - do not stop at January, continue through February, March, and April
CRITICAL: Look for assignments throughout the entire document, including "APPELLATE BRIEF DUE ON TWEN BY 8:00 P.M." and "ORAL ARGUMENTS April 3-4"
CRITICAL: If an assignment mentions a specific date (like "Jan 24", "April 3-4", "March 31"), extract it with that date and put in assignments/exams
CRITICAL: If an assignment mentions "bring to class", "due in class", "class on [date]", "complete on [date]", or "finish by [date]", it has a specific date - put in assignments/exams
CRITICAL: If an assignment mentions "submit on TWEN", "submit online", or "submit by [general time]" without a specific date, put in activities
CRITICAL: If an assignment says "complete [something] on [date]" or "finish [something] by [date]", extract with that specific date
CRITICAL: If you see "Week X [Day]:" format, extract the assignment with a calculated date based on the week and day
CRITICAL: If you cannot calculate a specific date for "Week X [Day]:" format, preserve the week information in the activity title (e.g., "Week 1 Monday: Introduction materials")
CRITICAL: Only put items with NO specific dates in the activities section

GENERAL CLASSIFICATION RULES:
- DATED EVENTS (assignments/exams): Items with specific dates, "due on [date]", "class on [date]", "bring to class on [date]", "complete on [date]", "finish by [date]"
- ACTIVITIES: Items with no specific dates, "submit online", "submit by end of semester", "ongoing assignments"
- EXAMS: Tests, quizzes, presentations, oral arguments with specific dates
- ASSIGNMENTS: Homework, papers, projects, evaluations, surveys with specific due dates

Return JSON with this structure:
{
  "assignments": [
    {
      "title": "The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206",
      "due_date": "2025-01-17",
      "details": "Read: The Handbook for the New Legal Writer: Chapters 25-28, pages 181-206",
      "priority": "medium"
    },
    {
      "title": "Sample Motions, pages 245-76",
      "due_date": "2025-01-17",
      "details": "Read: Sample Motions, pages 245-76",
      "priority": "medium"
    },
    {
      "title": "Syllabus and Assignment Schedule",
      "due_date": "2025-01-24",
      "details": "Read: Syllabus and Assignment Schedule",
      "priority": "medium"
    },
    {
      "title": "Handbook: Chapters 29-32, pages 207-44",
      "due_date": "2025-01-24",
      "details": "Read: Handbook: Chapters 29-32, pages 207-44",
      "priority": "medium"
    },
    {
      "title": "Bring draft of Partial Motion or Opposition to class (2 printed copies)",
      "due_date": "2025-01-24",
      "details": "Bring draft of Partial Motion or Opposition to class (2 printed copies)",
      "priority": "high"
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
      const dateStr = assignment.due_date + 'T00:00:00';
      const date = new Date(dateStr);
      console.log(`Assignment: ${assignment.title}, Original date: ${assignment.due_date}, Processed date: ${date.toISOString()}, Local date: ${date.toLocaleDateString()}`);
      
      events.push({
        id: this.generateEventId(assignment.title, new Date(assignment.due_date)),
        title: assignment.title,
        description: assignment.details,
        date: date, // Ensure local timezone
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
        date: new Date(exam.date + 'T00:00:00'), // Ensure local timezone
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