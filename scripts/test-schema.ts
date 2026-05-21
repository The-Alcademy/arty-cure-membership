import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let assertionNum = 0;

function pass(label: string) {
  assertionNum++;
  console.log(`  PASS  ${assertionNum}. ${label}`);
}

function fail(label: string, detail: unknown): never {
  assertionNum++;
  console.error(`  FAIL  ${assertionNum}. ${label}`);
  console.error('        detail:', detail);
  process.exit(1);
}

async function cleanup() {
  const { error } = await supabase
    .from('members')
    .delete()
    .like('email', '%@example.com');
  if (error) {
    console.error('cleanup failed:', error);
    process.exit(1);
  }
}

async function main() {
  console.log('Running schema verification against', url);
  await cleanup();

  // 1. First insert gets MEM-0001
  {
    const { data, error } = await supabase
      .from('members')
      .insert({ email: 'test1@example.com', name: 'Test One', arty_active: true })
      .select('member_number')
      .single();
    if (error) fail('insert test1@example.com', error);
    if (data?.member_number !== 'MEM-0001') {
      fail('first insert produces MEM-0001', `got ${data?.member_number}`);
    }
    pass('first insert produces MEM-0001');
  }

  // 2. Second insert gets MEM-0002
  {
    const { data, error } = await supabase
      .from('members')
      .insert({ email: 'test2@example.com', name: 'Test Two', cure_active: true })
      .select('member_number')
      .single();
    if (error) fail('insert test2@example.com', error);
    if (data?.member_number !== 'MEM-0002') {
      fail('second insert produces MEM-0002', `got ${data?.member_number}`);
    }
    pass('second insert produces MEM-0002');
  }

  // 3. is_active_member returns full record for active member
  {
    const { data, error } = await supabase.rpc('is_active_member', {
      p_email: 'test1@example.com',
    });
    if (error) fail('is_active_member(test1@example.com)', error);
    const row = Array.isArray(data) ? data[0] : data;
    const expected = {
      is_member: true,
      arty: true,
      cure: false,
      member_number: 'MEM-0001',
      name: 'Test One',
    };
    const ok =
      row &&
      row.is_member === expected.is_member &&
      row.arty === expected.arty &&
      row.cure === expected.cure &&
      row.member_number === expected.member_number &&
      row.name === expected.name;
    if (!ok) fail('is_active_member returns correct fields', { row, expected });
    pass('is_active_member returns correct fields for active member');
  }

  // 4. Case-insensitive lookup
  {
    const { data, error } = await supabase.rpc('is_active_member', {
      p_email: 'TEST1@EXAMPLE.COM',
    });
    if (error) fail('is_active_member(TEST1@EXAMPLE.COM)', error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.member_number !== 'MEM-0001') {
      fail('case-insensitive lookup finds MEM-0001', row);
    }
    pass('case-insensitive lookup returns same row');
  }

  // 5. Unknown email returns zero rows
  {
    const { data, error } = await supabase.rpc('is_active_member', {
      p_email: 'nobody@example.com',
    });
    if (error) fail('is_active_member(nobody@example.com)', error);
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 0) fail('unknown email returns zero rows', rows);
    pass('unknown email returns zero rows');
  }

  // 6. Updating arty_active = false flips is_member to false
  {
    const { error: updErr } = await supabase
      .from('members')
      .update({ arty_active: false })
      .eq('email', 'test1@example.com');
    if (updErr) fail('update arty_active=false', updErr);

    const { data, error } = await supabase.rpc('is_active_member', {
      p_email: 'test1@example.com',
    });
    if (error) fail('is_active_member after deactivate', error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.is_member !== false) {
      fail('is_member becomes false after deactivating arty', row);
    }
    pass('is_member becomes false after deactivating last active club');
  }

  await cleanup();
  console.log(`\nAll ${assertionNum} assertions passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('unexpected error:', err);
  process.exit(1);
});
