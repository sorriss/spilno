import type { Environment } from './environment.model';

/** Прод. Пустые значения намеренно: createClient упадёт сразу, демо-режим в проде невозможен. */
export const environment: Environment = {
  supabase: { url: '', anonKey: '' },
};
