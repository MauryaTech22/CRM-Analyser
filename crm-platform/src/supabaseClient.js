import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://zzxqpnmdrvvfjzziojzr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6eHFwbm1kcnZ2Zmp6emlvanpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5Mjg0ODYsImV4cCI6MjA5MjUwNDQ4Nn0.JndN_zNjq8MurJNRVsRRqWkq90jQt4aZKdHErOEiZKc';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);