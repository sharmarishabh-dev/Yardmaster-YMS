import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("Fetching all slots...");
  const { data: slots, error } = await supabase.from('yard_slots').select('*');
  if (error) throw error;

  // Group by zone + slot_number
  const groups = {};
  for (const s of slots) {
    const key = `${s.zone}-${s.slot_number}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }

  for (const [key, group] of Object.entries(groups)) {
    if (group.length > 1) {
      console.log(`Fixing duplicate slots for ${key}...`);
      
      // Prefer the ID that starts with '50000001', or the first one if none do
      group.sort((a, b) => {
        if (a.id.startsWith('50000001') && !b.id.startsWith('50000001')) return -1;
        if (b.id.startsWith('50000001') && !a.id.startsWith('50000001')) return 1;
        return 0;
      });

      const canonical = group[0];
      const duplicates = group.slice(1);

      // 1. Rename ALL of them to temporary names to free up the target code (e.g., 'A01')
      for (let i = 0; i < group.length; i++) {
        await supabase.from('yard_slots')
          .update({ code: `TEMP-${Date.now()}-${i}` })
          .eq('id', group[i].id);
      }

      // 2. Point any foreign keys from duplicates to the canonical ID
      for (const dup of duplicates) {
        // Update tasks
        await supabase.from('tasks').update({ slot_id: canonical.id }).eq('slot_id', dup.id);
        // Update trailer_moves (to_slot_id)
        await supabase.from('trailer_moves').update({ to_slot_id: canonical.id }).eq('to_slot_id', dup.id);
        // Update trailer_moves (from_slot_id)
        await supabase.from('trailer_moves').update({ from_slot_id: canonical.id }).eq('from_slot_id', dup.id);
        
        // Delete the duplicate
        await supabase.from('yard_slots').delete().eq('id', dup.id);
        console.log(`  Deleted duplicate ${dup.id} (was ${dup.code})`);
      }

      // 3. Rename the canonical one to the correct target code
      const targetCode = `${canonical.zone}${String(canonical.slot_number).padStart(2, '0')}`;
      await supabase.from('yard_slots').update({ code: targetCode }).eq('id', canonical.id);
      console.log(`  Canonical ${canonical.id} is now ${targetCode}`);
    } else {
      // Just one slot, ensure it has the correct code
      const s = group[0];
      const targetCode = `${s.zone}${String(s.slot_number).padStart(2, '0')}`;
      if (s.code !== targetCode) {
        // Rename to a temp code first in case another slot has our target code (shouldn't happen, but safe)
        await supabase.from('yard_slots').update({ code: `TEMP-${Date.now()}` }).eq('id', s.id);
        await supabase.from('yard_slots').update({ code: targetCode }).eq('id', s.id);
        console.log(`Updated single ${s.id} to ${targetCode}`);
      }
    }
  }

  console.log("Database deduplication and rename complete!");
}

main().catch(console.error);
