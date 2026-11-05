import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/** null только в dev без настроенного проекта: тогда приложение работает на демо-данных. */
export const supabase = environment.supabase
  ? createClient(environment.supabase.url, environment.supabase.anonKey)
  : null;
