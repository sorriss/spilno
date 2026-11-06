import { Component, resource, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular';
import { formatMoney } from '../../core/money';
import { uk } from '../../i18n/uk';
import { TxRow } from '../../shell/tx-row';
import { loadTransactions, TxFilter } from './transactions.data';

const PAGE = 50;

@Component({
  selector: 'app-transactions',
  imports: [RouterLink, IonContent, IonSpinner, IonButton, TxRow],
  template: `
    <ion-content>
      <main class="page">
        <h1>{{ s.title }}</h1>
        <div class="segment" role="group" [attr.aria-label]="s.filterLabel">
          @for (f of filters; track f) {
            <button type="button" [attr.aria-pressed]="filter() === f" (click)="pick(f)">{{ s.filters[f] }}</button>
          }
        </div>

        @if (list.hasValue()) {
          @let l = list.value();
          @for (day of l.days; track day.key) {
            <section>
              <div class="day">
                <h2>{{ day.label }}</h2>
                @if (day.total) {
                  <span>{{ money(day.total) }}</span>
                }
              </div>
              <div class="tx-list">
                @for (tx of day.txs; track tx.id) {
                  <a class="tx-link" [routerLink]="['/tabs/transactions', tx.id]"><app-tx-row [tx]="tx" [showShared]="true" /></a>
                }
              </div>
            </section>
          } @empty {
            <p class="state">{{ s.empty }}</p>
          }
          @if (l.hasMore) {
            <button type="button" class="link-button" [disabled]="list.isLoading()" (click)="showMore()">{{ s.more }}</button>
          }
        } @else if (list.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="list.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-3);
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: calc(var(--sp-space-5) + env(safe-area-inset-top)) var(--sp-space-5) var(--sp-space-5);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 34px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .day {
      display: flex;
      justify-content: space-between;
      gap: var(--sp-space-3);
      padding: var(--sp-space-1);
      font-size: 13px;
      line-height: 18px;
      color: var(--sp-text-secondary);
    }
    h2 {
      margin: 0;
      font: inherit;
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-space-3);
      margin: 0;
      padding: var(--sp-space-5);
      font-size: 14px;
      color: var(--sp-text-secondary);
      text-align: center;
    }
    .state p {
      margin: 0;
    }
  `,
})
export class TransactionsPage {
  protected readonly t = uk;
  protected readonly s = uk.transactions;
  protected readonly filters: TxFilter[] = ['all', 'shared', 'mine'];
  protected readonly filter = signal<TxFilter>('all');
  private readonly limit = signal(PAGE);

  /** Лимит не в params: при «Показати ще» список остаётся на экране, а не сменяется спиннером. */
  protected readonly list = resource({
    params: () => this.filter(),
    loader: ({ params }) => loadTransactions(params, untracked(this.limit)),
  });

  /** Страница живёт в стеке Ionic: операцию могли добавить, а в деталях удалить. */
  ionViewWillEnter(): void {
    this.list.reload();
  }

  protected pick(filter: TxFilter): void {
    this.limit.set(PAGE);
    this.filter.set(filter);
  }

  protected showMore(): void {
    this.limit.update((n) => n + PAGE);
    this.list.reload();
  }

  protected money(kopecks: number): string {
    return formatMoney(kopecks);
  }
}
