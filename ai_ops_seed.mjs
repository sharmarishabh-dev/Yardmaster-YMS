import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("Engineering scenario for AI Ops...");
  const now = new Date();

  // 1. Docks
  console.log("Fetching docks...");
  const { data: docks } = await supabase.from('docks').select('*').in('zone', ['A', 'B', 'C']).eq('status', 'available');
  const dockA = docks.find(d => d.zone === 'A');
  const dockB = docks.find(d => d.zone === 'B');
  
  if (!dockA || !dockB) throw new Error("Need available docks in Zone A and B");

  // 2. Appointments
  console.log("Creating 3 upcoming appointments for Zone A and 3 for Zone B...");
  
  const appts = [];
  for (let i = 1; i <= 3; i++) {
    // Zone A appt starting in 15 mins
    const startA = new Date(now.getTime() + 15 * 60000);
    const endA = new Date(startA.getTime() + 60 * 60000);
    appts.push({
      dock_id: dockA.id,
      carrier: 'AI Seed Carrier A' + i,
      carrier_category: 'standard',
      reference: 'AI-SEED-A' + i,
      appointment_type: 'inbound',
      status: 'scheduled',
      starts_at: startA.toISOString(),
      ends_at: endA.toISOString(),
    });

    // Zone B appt starting in 25 mins
    const startB = new Date(now.getTime() + 25 * 60000);
    const endB = new Date(startB.getTime() + 60 * 60000);
    appts.push({
      dock_id: dockB.id,
      carrier: 'AI Seed Carrier B' + i,
      carrier_category: 'standard',
      reference: 'AI-SEED-B' + i,
      appointment_type: 'outbound',
      status: 'scheduled',
      starts_at: startB.toISOString(),
      ends_at: endB.toISOString(),
    });
  }

  // Clear existing AI seed appts if any
  await supabase.from('dock_appointments').delete().like('reference', 'AI-SEED-%');
  await supabase.from('dock_appointments').insert(appts);

  // 3. Yard Slots Occupancy
  console.log("Configuring Yard Slots...");
  
  const { data: slots } = await supabase.from('yard_slots').select('*');
  
  const staleTime = new Date(now.getTime() - 45 * 60000).toISOString(); // 45 mins ago

  // Zone A: Make exactly 9 slots occupied (75%)
  const slotsA = slots.filter(s => s.zone === 'A');
  for (let i = 0; i < slotsA.length; i++) {
    const status = i < 9 ? 'occupied' : 'empty';
    await supabase.from('yard_slots')
      .update({ status, updated_at: staleTime })
      .eq('id', slotsA[i].id);
  }

  // Zone B: Make exactly 6 slots occupied (50%)
  const slotsB = slots.filter(s => s.zone === 'B');
  for (let i = 0; i < slotsB.length; i++) {
    const status = i < 6 ? 'occupied' : 'empty';
    await supabase.from('yard_slots')
      .update({ status, updated_at: staleTime })
      .eq('id', slotsB[i].id);
  }

  // Zone C: Make all 12 slots empty (so it becomes the target for smart re-spots)
  const slotsC = slots.filter(s => s.zone === 'C');
  for (let i = 0; i < slotsC.length; i++) {
    await supabase.from('yard_slots')
      .update({ status: 'empty', updated_at: now.toISOString() })
      .eq('id', slotsC[i].id);
  }

  // Also remove any scheduled appointments for Zone C in the next hour to ensure demand = 0
  const dockCIds = docks.filter(d => d.zone === 'C').map(d => d.id);
  if (dockCIds.length > 0) {
     const anHourFromNow = new Date(now.getTime() + 60 * 60000).toISOString();
     await supabase.from('dock_appointments')
       .update({ status: 'completed' })
       .in('dock_id', dockCIds)
       .eq('status', 'scheduled')
       .lt('starts_at', anHourFromNow);
  }

  console.log("Seed complete! AI Ops should now show:");
  console.log("- Zone A: Critical congestion (75% occ, 3 appts)");
  console.log("- Zone B: Warning congestion (50% occ, 3 appts)");
  console.log("- Smart Re-spots: Moving stale trailers from A & B to empty Zone C");
}

main().catch(console.error);
