import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function fetchTodos() {
  const { data, error } = await supabase.from('todos').select('*')
  if (error) throw error
  return data
}

export default supabase
