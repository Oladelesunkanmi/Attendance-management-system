import LecturerLayout from '../../components/LecturerLayout';
import { Link } from 'react-router-dom';

export default function SuperviseEnrolmentPage() {
  return (
    <LecturerLayout
      title="Students"
      subtitle="Supervise biometric enrolment in person"
    >
      <div className="max-w-xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 font-semibold text-gray-900">In-person enrolment supervision</h2>
          <p className="mb-5 text-sm text-gray-500">
            Confirm the student's physical ID before they register biometrics on their own device.
          </p>

          <ol className="space-y-3 pl-1">
            {[
              'Ask the student to sign in on their own device.',
              'Verify their physical ID card matches their matric number.',
              'Student opens Enrol biometrics and completes fingerprint or Face ID.',
              'The enrolment record stores your lecturer ID as enrolled_by.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-700 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            In-app confirmation is handled on the student enrolment screen once they enter your lecturer ID.
          </div>

          <Link
            to="/student/enrol"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Preview student enrolment screen →
          </Link>
        </div>
      </div>
    </LecturerLayout>
  );
}
