import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: docks } = await supabase.from('docks').select('id');
  const orphanedIds = docks.filter(d => !d.id.startsWith('d0000001-')).map(d => d.id);
  
  if (orphanedIds.length > 0) {
    for (const id of orphanedIds) {
      await supabase.from('docks').delete().eq('id', id);
      console.log(`Deleted orphaned dock ${id}`);
    }
    console.log("Cleanup complete!");
  } else {
    console.log("No orphaned docks found.");
  }
}

main().catch(console.error);
