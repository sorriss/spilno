import { Component, computed, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronDown, chevronForward } from 'ionicons/icons';
import { formatAmount, formatMoney } from '../../core/money';
import { uk } from '../../i18n/uk';
import { nameOf, TxRow } from '../../shell/tx-row';
import { isDemo, loadOverview } from './overview.data';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, IonContent, IonIcon, IonSpinner, IonButton, TxRow],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage {
  protected readonly t = uk;
  protected readonly isDemo = isDemo;
  protected readonly formatMoney = formatMoney;
  protected readonly formatAmount = formatAmount;
  protected readonly nameOf = nameOf;

  protected readonly month = signal(startOfMonth(new Date()));
  protected readonly monthLabel = computed(
    () => `${uk.months[this.month().getMonth()]} ${this.month().getFullYear()}`,
  );
  protected readonly isCurrentMonth = computed(() => this.month() >= startOfMonth(new Date()));

  /** Страница живёт в стеке Ionic: после «Нової витрати» или в другой вкладке данные могли измениться. */
  ionViewWillEnter(): void {
    this.overview.reload();
  }

  protected readonly overview = resource({
    params: () => this.month(),
    loader: ({ params }) => loadOverview(params),
  });

  constructor() {
    addIcons({ chevronBack, chevronDown, chevronForward });
  }

  protected shiftMonth(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
