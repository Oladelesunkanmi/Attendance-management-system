import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import LecturerLayout from '../../components/LecturerLayout';
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

  useEffect(() => { loadVenues(); }, []);

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
    else { setName(''); setLatitude(''); setLongitude(''); await loadVenues(); }
  }

  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLatitude(String(pos.coords.latitude)); setLongitude(String(pos.coords.longitude)); },
      (err) => setError(err.message),
    );
  }

  return (
    <LecturerLayout title="Venues" subtitle="Register classroom coordinates for geofence verification">
      <div className="max-w-2xl space-y-6">
        {/* Add venue form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-gray-900">Add a venue</h2>
          <form onSubmit={createVenue} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Venue name</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. LT4 — New Science Block"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Latitude</label>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="7.4654"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Longitude</label>
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="3.9169"
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Geofence radius (metres)</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2 focus:border-blue-500 transition"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                required
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={useCurrentLocation}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                📍 Use current GPS
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
              >
                Add venue
              </button>
            </div>
          </form>
        </div>

        {/* Venue list */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Registered venues ({venues.length})</h2>
          </div>
          {venues.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-400">No venues yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {venues.map((venue) => (
                <li key={venue.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{venue.name}</p>
                    <p className="text-sm text-gray-500">
                      {venue.latitude.toFixed(5)}, {venue.longitude.toFixed(5)} · {venue.radius_meters}m radius
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LecturerLayout>
  );
}
