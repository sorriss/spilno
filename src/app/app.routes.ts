import { Routes } from '@angular/router';
import { authGuard, familyGuard, guestGuard } from './core/guards';
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

  {
    path: 'welcome',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/welcome/welcome.page').then((m) => m.WelcomePage),
  },
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/sign-in/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'family-setup',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/family-setup/family-setup.page').then((m) => m.FamilySetupPage),
  },

  // Вне табов: у формы новой операции нет таб-бара.
  {
    path: 'new',
    canActivate: [authGuard, familyGuard],
    loadComponent: () => import('./pages/new-expense/new-expense.page').then((m) => m.NewExpensePage),
  },

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
      {
        path: 'more',
        loadComponent: () => import('./pages/more/more.page').then((m) => m.MorePage),
      },
      {
        path: 'more/family',
        loadComponent: () => import('./pages/family/family.page').then((m) => m.FamilyPage),
      },
      stub('more/accounts', uk.pages.accounts, '/tabs/more'),
      stub('more/categories', uk.pages.categories, '/tabs/more'),
      stub('more/settings', uk.pages.settings, '/tabs/more'),
    ],
  },

  { path: '**', redirectTo: 'tabs/overview' },
];
