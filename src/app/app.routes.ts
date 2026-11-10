import { Routes } from '@angular/router';
import { authGuard, familyGuard, guestGuard } from './core/guards';
import { i18n } from './i18n';

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
    path: 'privacy',
    loadComponent: () => import('./pages/privacy.page').then((m) => m.PrivacyPage),
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
    path: 'edit/:id',
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
      {
        path: 'overview/analytics',
        loadComponent: () => import('./pages/analytics/analytics.page').then((m) => m.AnalyticsPage),
      },
      {
        path: 'transactions',
        loadComponent: () => import('./pages/transactions/transactions.page').then((m) => m.TransactionsPage),
      },
      {
        path: 'transactions/:id',
        loadComponent: () =>
          import('./pages/transaction-details/transaction-details.page').then((m) => m.TransactionDetailsPage),
      },
      {
        path: 'settle',
        loadComponent: () => import('./pages/settle/settle.page').then((m) => m.SettlePage),
      },
      {
        path: 'settle/history',
        loadComponent: () => import('./pages/settle/settle-history.page').then((m) => m.SettleHistoryPage),
      },
      {
        path: 'more',
        loadComponent: () => import('./pages/more/more.page').then((m) => m.MorePage),
      },
      {
        path: 'more/family',
        loadComponent: () => import('./pages/family/family.page').then((m) => m.FamilyPage),
      },
      {
        path: 'more/profile',
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'more/accounts',
        loadComponent: () => import('./pages/accounts/accounts.page').then((m) => m.AccountsPage),
      },
      {
        path: 'more/categories',
        loadComponent: () => import('./pages/categories/categories.page').then((m) => m.CategoriesPage),
      },
      {
        path: 'more/mono',
        loadComponent: () => import('./pages/mono/mono.page').then((m) => m.MonoPage),
      },
      {
        path: 'more/rules',
        loadComponent: () => import('./pages/rules/rules.page').then((m) => m.RulesPage),
      },
      stub('more/settings', i18n.pages.settings, '/tabs/more'),
    ],
  },

  { path: '**', redirectTo: 'tabs/overview' },
];
