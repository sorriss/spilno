import { Component, computed, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronDown, chevronForward } from 'ionicons/icons';
import { formatAmount, formatMoney } from '../../core/money';
import { i18n } from '../../i18n';
import { nameOf, TxRow } from '../../shell/tx-row';
import { dismissRefund, linkRefund, loadRefundSuggestions, RefundSuggestion } from '../../core/refunds';
import { isDemo, loadOverview } from './overview.data';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, IonContent, IonIcon, IonSpinner, IonButton, TxRow],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage {
  protected readonly t = i18n;
  protected readonly isDemo = isDemo;
  protected readonly formatMoney = formatMoney;
  protected readonly formatAmount = formatAmount;
  protected readonly nameOf = nameOf;

  protected readonly month = signal(startOfMonth(new Date()));
  protected readonly monthLabel = computed(
    () => `${i18n.months[this.month().getMonth()]} ${this.month().getFullYear()}`,
  );
  protected readonly isCurrentMonth = computed(() => this.month() >= startOfMonth(new Date()));

  /** Страница живёт в стеке Ionic: после «Нової витрати» или в другой вкладке данные могли измениться. */
  ionViewWillEnter(): void {
    this.overview.reload();
    this.refunds.reload();
  }

  /** Отдельно от обзора: если подсказки не загрузились, обзор всё равно показывается. */
  protected readonly refunds = resource({ loader: () => (isDemo ? Promise.resolve([]) : loadRefundSuggestions()) });
  protected readonly refundBusy = signal(false);
  protected readonly refundError = signal('');

  protected readonly overview = resource({
    params: () => this.month(),
    loader: ({ params }) => loadOverview(params),
  });

  constructor() {
    addIcons({ chevronBack, chevronDown, chevronForward });
  }

  /** Привязка меняет сумму траты и балансы, поэтому перечитываем и обзор. */
  protected async answerRefund(r: RefundSuggestion, link: boolean): Promise<void> {
    if (this.refundBusy()) return;
    this.refundBusy.set(true);
    this.refundError.set('');
    try {
      await (link ? linkRefund(r.income.id, r.expense.id) : dismissRefund(r.income.id));
      this.refunds.reload();
      if (link) this.overview.reload();
    } catch {
      this.refundError.set(i18n.overview.refundError);
    } finally {
      this.refundBusy.set(false);
    }
  }

  protected shiftMonth(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
