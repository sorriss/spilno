import { Component, computed, resource, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronForward } from 'ionicons/icons';
import { formatAmount } from '../../core/money';
import { uk } from '../../i18n/uk';
import { CATEGORY_ICONS } from '../../shell/tx-row';
import { loadAnalytics } from './analytics.data';

type View = 'family' | 'mine';

/** Траты по категориям за месяц и столбцы за полгода. Один цвет: категорию называет подпись, а не оттенок. */
@Component({
  selector: 'app-analytics',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, IonIcon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/overview" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <div class="segment" role="group" [attr.aria-label]="s.viewLabel">
          @for (v of views; track v) {
            <button type="button" [attr.aria-pressed]="view() === v" (click)="view.set(v)">{{ s.views[v] }}</button>
          }
        </div>

        <div class="month">
          <button type="button" [attr.aria-label]="t.overview.previousMonth" (click)="shiftMonth(-1)">
            <ion-icon name="chevron-back" aria-hidden="true" />
          </button>
          <span>{{ label(month()) }}</span>
          <button type="button" [attr.aria-label]="t.overview.nextMonth" [disabled]="isCurrentMonth()" (click)="shiftMonth(1)">
            <ion-icon name="chevron-forward" aria-hidden="true" />
          </button>
        </div>

        @if (data.error()) {
          <section class="card state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="data.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else if (!data.hasValue()) {
          <div class="state"><ion-spinner /></div>
        } @else {
          @let d = data.value();
          <section class="card">
            <h2 class="caption">{{ view() === 'family' ? s.spentFamily : s.spentMine }}</h2>
            <p class="total">{{ amount(d.total) }} <span class="currency">{{ t.currency }}</span></p>
            @if (view() === 'mine') {
              <p class="hint">{{ s.mineHint }}</p>
            }

            <h3 class="caption">{{ s.trend }}</h3>
            <div class="trend">
              @for (m of d.trend; track m.month.getTime()) {
                @let selected = $last;
                <button
                  type="button"
                  class="column"
                  [class.selected]="selected"
                  [attr.aria-label]="s.monthBar(label(m.month), amount(m.total) + ' ' + t.currency)"
                  [attr.aria-current]="selected ? 'date' : null"
                  (click)="pick(m.month)"
                >
                  <span class="value">{{ selected ? amount(m.total) : '' }}</span>
                  <span class="track"><span class="fill" [style.height.%]="peak() ? (m.total / peak()) * 100 : 0"></span></span>
                  <span class="name">{{ t.monthsShort[m.month.getMonth()] }}</span>
                </button>
              }
            </div>
          </section>

          <section class="card">
            <h2 class="caption">{{ s.byCategory }}</h2>
            @if (d.categories.length) {
              <ul>
                @for (c of d.categories; track c.id) {
                  <li>
                    <span class="icon" [class]="c.colorIndex === null ? 'tone-neutral' : 'tone-' + c.colorIndex">
                      <ion-icon [name]="c.icon" aria-hidden="true" />
                    </span>
                    <span class="row">
                      <span class="line">
                        <span class="label">{{ c.name ?? s.noCategory }}</span>
                        <span class="sum">{{ amount(c.amount) }} {{ t.currency }}</span>
                      </span>
                      <span class="line sub">
                        <span class="bar"><span [style.width.%]="(c.amount / d.categories[0].amount) * 100"></span></span>
                        <span>{{ percent(c.amount, d.total) }}</span>
                      </span>
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="hint">{{ s.empty }}</p>
            }
          </section>

          @if (view() === 'mine' && d.transfers) {
            <section class="card transfers">
              <span class="icon tone-neutral"><ion-icon name="swap-horizontal-outline" aria-hidden="true" /></span>
              <span class="row">
                <span class="line">
                  <span class="label">{{ s.transfers }}</span>
                  <span class="sum muted">{{ amount(d.transfers) }} {{ t.currency }}</span>
                </span>
                <span class="hint">{{ s.transfersHint }}</span>
              </span>
            </section>
          }
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
      padding: var(--sp-space-3) var(--sp-space-5) var(--sp-space-5);
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-2);
      padding: var(--sp-space-4);
      border-radius: var(--sp-radius-card);
      background: var(--sp-surface);
    }
    .caption {
      margin: 0;
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    h3.caption {
      margin-top: var(--sp-space-3);
    }
    .total {
      margin: 0;
      font-size: 36px;
      line-height: 42px;
      font-weight: 800;
    }
    .currency {
      font-size: 20px;
    }
    .hint {
      margin: 0;
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
    }
    .trend {
      display: flex;
      gap: 2px;
      height: 148px;
    }
    .column {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-space-1);
      min-width: 44px;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: var(--sp-text-secondary);
      cursor: pointer;
    }
    .column .value {
      min-height: 16px;
      font-size: 11px;
      font-weight: 700;
      color: var(--sp-text);
      white-space: nowrap;
    }
    .track {
      display: flex;
      flex: 1;
      align-items: flex-end;
      justify-content: center;
      width: 100%;
    }
    .fill {
      width: 60%;
      min-height: 2px;
      border-radius: 4px 4px 0 0;
      background: var(--sp-chart-muted);
    }
    .column.selected .fill {
      background: var(--ion-color-primary);
    }
    .column .name {
      font-size: 11px;
      line-height: 16px;
      font-weight: 600;
    }
    .column.selected .name {
      color: var(--sp-text);
      font-weight: 800;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li,
    .transfers {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 56px;
    }
    .transfers {
      flex-direction: row;
    }
    li + li {
      border-top: 1px solid var(--sp-divider);
    }
    .icon {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: var(--sp-radius-button);
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 20px;
    }
    .row {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--sp-space-1);
      min-width: 0;
    }
    .line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-space-3);
    }
    .label {
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .sum {
      flex: none;
      font-size: 15px;
      font-weight: 700;
    }
    .sum.muted {
      color: var(--sp-text-secondary);
    }
    .line.sub {
      font-size: 12px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    .bar {
      flex: 1;
      height: 6px;
    }
    .bar span {
      display: block;
      height: 100%;
      min-width: 2px;
      border-radius: 0 4px 4px 0;
      background: var(--ion-color-primary);
    }
    .state {
      align-items: center;
      padding: var(--sp-space-5);
      font-size: 14px;
      color: var(--sp-text-secondary);
    }
    .state p {
      margin: 0;
    }
  `,
})
export class AnalyticsPage {
  protected readonly t = uk;
  protected readonly s = uk.analytics;
  protected readonly views: View[] = ['family', 'mine'];
  protected readonly view = signal<View>('family');
  protected readonly month = signal(startOfMonth(new Date()));
  protected readonly isCurrentMonth = computed(() => this.month() >= startOfMonth(new Date()));
  protected readonly data = resource({
    params: () => ({ month: this.month(), mine: this.view() === 'mine' }),
    loader: ({ params }) => loadAnalytics(params.month, params.mine),
  });
  protected readonly peak = computed(() =>
    this.data.hasValue() ? Math.max(...this.data.value().trend.map((m) => m.total)) : 0,
  );

  constructor() {
    addIcons({ ...CATEGORY_ICONS, chevronBack, chevronForward });
  }

  /** Страница живёт в стеке Ionic: после новой операции суммы могли измениться. */
  ionViewWillEnter(): void {
    this.data.reload();
  }

  protected label(m: Date): string {
    return `${uk.months[m.getMonth()]} ${m.getFullYear()}`;
  }

  protected amount(kopecks: number): string {
    return formatAmount(kopecks, { trimZero: true });
  }

  protected percent(part: number, total: number): string {
    return total ? `${Math.round((part / total) * 100)}%` : '';
  }

  protected shiftMonth(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  protected pick(month: Date): void {
    this.month.set(month);
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
