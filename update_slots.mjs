import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("Fetching existing slots...");
  const { data: slots, error } = await supabase.from('yard_slots').select('*');
  if (error) throw error;
  
  // 1. Update existing slots to the new format (e.g. A01, A02)
  for (const s of slots) {
    const newCode = `${s.zone}${String(s.slot_number).padStart(2, '0')}`;
    if (s.code !== newCode) {
      await supabase.from('yard_slots').update({ code: newCode }).eq('id', s.id);
      console.log(`Updated ${s.code} -> ${newCode}`);
    }
  }

  // 2. Insert missing slots up to 12 for A, B, C
  for (const zone of ['A', 'B', 'C']) {
    for (let i = 1; i <= 12; i++) {
      const code = `${zone}${String(i).padStart(2, '0')}`;
      const existing = slots.find(s => s.zone === zone && s.slot_number === i);
      if (!existing) {
         await supabase.from('yard_slots').insert({
           zone: zone,
           code: code,
           row_label: zone,
           slot_number: i,
           slot_type: 'parking',
           status: 'empty',
           x: i * 2, // arbitrary
           y: i * 2
         });
         console.log(`Inserted missing slot ${code}`);
      }
    }
  }
  console.log("Database update complete!");

  // 3. Also fix the seed file so future resets work properly.
  const seedPath = path.resolve(process.cwd(), 'supabase/migrations/00000000000005_india_seed.sql');
  let seedSql = fs.readFileSync(seedPath, 'utf-8');

  // Replace slot codes in the SQL file
  for (const s of slots) {
    const newCode = `${s.zone}${String(s.slot_number).padStart(2, '0')}`;
    // Replace exact code occurrences like 'A-P01' -> 'A01'
    const reCode = new RegExp(`'${s.code}'`, 'g');
    seedSql = seedSql.replace(reCode, `'${newCode}'`);
    
    // Also replace inside text instructions, e.g. "from A-P01" -> "from A01"
    const reText = new RegExp(s.code, 'g');
    seedSql = seedSql.replace(reText, newCode);
  }
  
  fs.writeFileSync(seedPath, seedSql);
  console.log("Seed file updated!");
}

main().catch(console.error);
