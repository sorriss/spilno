import { Routes } from '@angular/router';
import { authGuard, familyGuard } from './core/guards';
import { uk } from './i18n/uk';

const placeholder = () => import('./pages/placeholder.page').then((m) => m.PlaceholderPage);

/** Экран ещё не сделан: при его реализации заменить loadComponent на свой. Карта — в docs/architecture.md. */
const stub = (path: string, title: string, back?: string) => ({
  path,
  loadComponent: placeholder,
  data: { title, back },
});

export const routes: Routes = [
  { path: '', redirectTo: 'tabs/overview', pathMatch: 'full' },

  stub('welcome', uk.pages.welcome),
  stub('sign-in', uk.pages.signIn),
  { ...stub('family-setup', uk.pages.familySetup), canActivate: [authGuard] },

  // Вне табов: у формы новой операции нет таб-бара.
  { ...stub('new', uk.pages.newExpense, '/tabs/overview'), canActivate: [authGuard, familyGuard] },

  {
    path: 'tabs',
    canActivate: [authGuard, familyGuard],
    loadComponent: () => import('./shell/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      {
        path: 'overview',
        loadComponent: () => import('./pages/overview/overview.page').then((m) => m.OverviewPage),
      },
      stub('transactions', uk.pages.transactions),
      stub('transactions/:id', uk.pages.transactionDetails, '/tabs/transactions'),
      stub('transactions/:id/split', uk.pages.editSplit, '/tabs/transactions'),
      stub('settle', uk.pages.settle),
      stub('settle/history', uk.pages.settleHistory, '/tabs/settle'),
      stub('more', uk.pages.more),
      stub('more/family', uk.pages.family, '/tabs/more'),
      stub('more/accounts', uk.pages.accounts, '/tabs/more'),
      stub('more/categories', uk.pages.categories, '/tabs/more'),
      stub('more/settings', uk.pages.settings, '/tabs/more'),
    ],
  },

  { path: '**', redirectTo: 'tabs/overview' },
];
