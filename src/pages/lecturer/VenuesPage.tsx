import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Card, ErrorText, Input, Label, Shell } from '../../components/ui';
import type { Database } from '../../lib/database.types';

type Venue = Database['public']['Tables']['venues']['Row'];

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('25');
  const [error, setError] = useState<string | null>(null);

  async function loadVenues() {
    const { data, error: loadError } = await supabase.from('venues').select('*').order('name');
    if (loadError) setError(loadError.message);
    else setVenues(data ?? []);
  }

  useEffect(() => {
    loadVenues();
  }, []);

  async function createVenue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: insertError } = await supabase.from('venues').insert({
      name,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radius_meters: Number(radius),
    });
    if (insertError) setError(insertError.message);
    else {
      setName('');
      setLatitude('');
      setLongitude('');
      await loadVenues();
    }
  }

  async function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      setLatitude(String(pos.coords.latitude));
      setLongitude(String(pos.coords.longitude));
    }, (err) => setError(err.message));
  }

  return (
    <Shell title="Venues">
      <div className="mb-4">
        <Link to="/" className="text-sm text-emerald-400">← Home</Link>
      </div>
      <Card>
        <form onSubmit={createVenue} className="space-y-3">
          <div>
            <Label>Venue name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Latitude</Label>
              <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} required />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} required />
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={useCurrentLocation}>
            Use current GPS
          </Button>
          <div>
            <Label>Radius (meters)</Label>
            <Input value={radius} onChange={(e) => setRadius(e.target.value)} required />
          </div>
          <Button type="submit">Add venue</Button>
          <ErrorText>{error}</ErrorText>
        </form>
      </Card>
      <div className="mt-6 space-y-3">
        {venues.map((venue) => (
          <Card key={venue.id}>
            <p className="font-medium">{venue.name}</p>
            <p className="text-sm text-slate-400">
              {venue.latitude}, {venue.longitude} · {venue.radius_meters}m radius
            </p>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
