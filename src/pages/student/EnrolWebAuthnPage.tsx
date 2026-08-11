import { useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useAuth } from '../../contexts/AuthContext';
import { callEdgeFunction } from '../../lib/supabase';
import { Button, Card, ErrorText, Input, Label, Shell } from '../../components/ui';

export default function EnrolWebAuthnPage() {
  const { profile } = useAuth();
  const [lecturerId, setLecturerId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEnrol() {
    if (!profile) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const { options } = await callEdgeFunction<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        'webauthn-register',
        { step: 'options' },
      );

      const attestationResponse = await startRegistration({ optionsJSON: options });

      await callEdgeFunction('webauthn-register', {
        step: 'verify',
        attestationResponse,
        enrolledByLecturerId: lecturerId || null,
      });

      setStatus('Biometric enrolment complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrolment failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell title="Enrol biometrics" subtitle="Supervised one-time registration on this device">
      <div className="mb-4">
        <Link to="/" className="text-sm text-emerald-400">← Home</Link>
      </div>
      <Card>
        <p className="text-sm text-slate-300">
          Ask your lecturer to verify your ID card, then enter their user ID below (optional but recommended).
        </p>
        <div className="mt-4">
          <Label>Lecturer user ID (UUID)</Label>
          <Input value={lecturerId} onChange={(e) => setLecturerId(e.target.value)} placeholder="Optional" />
        </div>
        <Button className="mt-4" onClick={handleEnrol} disabled={loading}>
          {loading ? 'Waiting for biometrics…' : 'Start biometric enrolment'}
        </Button>
        {status ? <p className="mt-3 text-sm text-emerald-400">{status}</p> : null}
        <ErrorText>{error}</ErrorText>
      </Card>
    </Shell>
  );
}
