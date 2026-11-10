import type { Environment } from './environment.model';

/** Dev. Для демо-данных без входа поставьте supabase: null. */
export const environment: Environment = {
  supabase: { url: 'https://qggtvnnbhxfbjcrmldbo.supabase.co', anonKey: 'sb_publishable_AHJYcPPz-0phF3GX_1seEw_JH5RTzM1' },
  vapidPublicKey: 'BOS3Fd12qtzMQNraVpt0mvgmDKN7dc6-DOw1SyO6ke8xynmZI6kI35ChTF9aE1tbjCZqPVkSXosvBlRaSFXFRkM',
};
