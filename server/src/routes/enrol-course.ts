import { Router } from 'express';
import { requireStudent } from '../middleware/auth.js';

export const enrolCourseRouter = Router();

enrolCourseRouter.post('/', requireStudent, async (req, res) => {
  try {
    const { profile, serviceClient } = req.auth!;
    const { courseId } = req.body;

    if (!courseId) {
      res.status(400).json({ error: 'courseId is required' });
      return;
    }

    // 1. Verify the course exists
    const { data: course, error: courseErr } = await serviceClient
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .maybeSingle();

    if (courseErr || !course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }

    // 2. Check if already enrolled
    const { data: existing, error: existingErr } = await serviceClient
      .from('enrollments')
      .select('id')
      .eq('course_id', courseId)
      .eq('student_id', profile.id)
      .maybeSingle();

    if (existingErr) {
      throw existingErr;
    }

    if (existing) {
      res.json({ success: true, message: 'Already enrolled' });
      return;
    }

    // 3. Insert the enrollment using the service role to bypass RLS
    const { error: insertErr } = await serviceClient
      .from('enrollments')
      .insert({
        course_id: courseId,
        student_id: profile.id,
      });

    if (insertErr) {
      throw insertErr;
    }

    res.json({ success: true, message: 'Successfully enrolled' });
  } catch (err) {
    console.error('[enrol-course]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});
