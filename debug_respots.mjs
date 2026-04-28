import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const now = new Date();
  const horizonMs = 60 * 60000;

  const { data: docks } = await supabase.from('docks').select('*');
  const { data: slots } = await supabase.from('yard_slots').select('*');
  const { data: appts } = await supabase.from('dock_appointments').select('*');

  console.log(`Docks: ${docks.length}, Slots: ${slots.length}, Appts: ${appts.length}`);

  const dockZones = new Set(docks.filter((d) => d.status === "available").map((d) => d.zone));
  console.log("Dock zones available:", Array.from(dockZones));

  const upcomingZoneDemand = new Map();
  for (const a of appts) {
    if (a.status !== "scheduled") continue;
    const startMs = new Date(a.starts_at).getTime();
    if (startMs < now.getTime() || startMs > now.getTime() + horizonMs) continue;
    const dock = docks.find((d) => d.id === a.dock_id);
    if (!dock) continue;
    upcomingZoneDemand.set(dock.zone, (upcomingZoneDemand.get(dock.zone) ?? 0) + 1);
  }
  console.log("Upcoming demand:", upcomingZoneDemand);

  const occupied = slots.filter((s) => s.status === "occupied");
  const empty = slots.filter((s) => s.status === "empty");
  console.log(`Occupied slots: ${occupied.length}, Empty slots: ${empty.length}`);

  const gridDist = (a, b) => Math.abs((a.x || 0) - (b.x || 0)) + Math.abs((a.y || 0) - (b.y || 0));

  const respots = [];
  let rejectReasons = { noDemand: 0, notStale: 0, noCandidates: 0 };

  for (const src of occupied) {
    if (!dockZones.has(src.zone)) continue;
    const demand = upcomingZoneDemand.get(src.zone) ?? 0;
    if (demand < 1) { rejectReasons.noDemand++; continue; }

    const stale = src.updated_at
      ? Math.max(0, Math.round((now.getTime() - new Date(src.updated_at).getTime()) / 60000))
      : 0;
    
    if (stale < 0) { rejectReasons.notStale++; continue; }

    const candidates = empty
      .filter((e) => e.zone !== src.zone && (upcomingZoneDemand.get(e.zone) ?? 0) === 0)
      .map((e) => ({ slot: e, dist: gridDist(src, e) }))
      .sort((a, b) => b.dist - a.dist);
      
    if (candidates.length === 0) { rejectReasons.noCandidates++; continue; }
    const target = candidates[0];

    const score = demand * 10 + Math.min(stale, 240) * 0.05 - target.dist * 0.1;
    respots.push({
      from: src.code,
      to: target.slot.code,
      stale,
      score
    });
  }

  console.log("Reject Reasons:", rejectReasons);
  console.log("Generated Respots:", respots.length);
  if (respots.length > 0) {
    console.log(respots.slice(0, 3));
  }
}

main().catch(console.error);
