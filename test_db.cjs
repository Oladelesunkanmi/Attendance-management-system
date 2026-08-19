const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './server/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.from('webauthn_credentials').select('*');
  console.log("Error:", error);
  console.log("Credentials:", JSON.stringify(data, null, 2));
}

check();
