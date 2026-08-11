import { assertEquals } from 'jsr:@std/assert@1';
import { distanceMeters } from './haversine.ts';

Deno.test('distanceMeters returns ~0 for identical points', () => {
  assertEquals(distanceMeters(6.5244, 3.3792, 6.5244, 3.3792), 0);
});

Deno.test('distanceMeters matches known short distance', () => {
  const meters = distanceMeters(51.5007, -0.1246, 51.5010, -0.1246);
  assertEquals(Math.round(meters), 33);
});
