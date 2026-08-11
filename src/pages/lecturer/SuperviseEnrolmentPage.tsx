import { Link } from 'react-router-dom';
import { Shell, Card, Button } from '../../components/ui';

export default function SuperviseEnrolmentPage() {
  return (
    <Shell
      title="Supervise enrolment"
      subtitle="Confirm the student's ID in person before they register biometrics on their own phone."
    >
      <div className="mb-4">
        <Link to="/" className="text-sm text-emerald-400">← Home</Link>
      </div>
      <Card>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>Ask the student to sign in on their own device.</li>
          <li>Verify their physical ID card matches their matric number.</li>
          <li>Student opens <strong>Enrol biometrics</strong> and completes fingerprint/Face ID.</li>
          <li>The enrolment record stores your lecturer ID as <code>enrolled_by</code>.</li>
        </ol>
        <p className="mt-4 text-sm text-slate-400">
          In-app confirmation is handled on the student enrolment screen once they enter your lecturer ID.
        </p>
        <Link to="/student/enrol" className="mt-4 inline-block">
          <Button variant="secondary">Preview student enrolment screen</Button>
        </Link>
      </Card>
    </Shell>
  );
}
