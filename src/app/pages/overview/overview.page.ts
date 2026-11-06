import { Component, computed, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  airplaneOutline, bedOutline, busOutline, cafeOutline, cardOutline, carOutline, cartOutline, chevronBack,
  chevronDown, chevronForward, filmOutline, giftOutline, happyOutline, homeOutline, medkitOutline, pricetagOutline,
  shirtOutline, swapHorizontalOutline,
} from 'ionicons/icons';
import { formatAmount, formatMoney } from '../../core/money';
import { uk } from '../../i18n/uk';
import { Member, Overview, isDemo, loadOverview } from './overview.data';

type Recent = Overview['recent'][number];

@Component({
  selector: 'app-overview',
  imports: [RouterLink, IonContent, IonIcon, IonSpinner, IonButton],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
})
export class OverviewPage {
  protected readonly t = uk;
  protected readonly isDemo = isDemo;
  protected readonly formatMoney = formatMoney;
  protected readonly formatAmount = formatAmount;

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
    // Иконки категорий из create_family: новую категорию с другой иконкой регистрировать здесь же.
    addIcons({
      airplaneOutline, bedOutline, busOutline, cafeOutline, cardOutline, carOutline, cartOutline, chevronBack,
      chevronDown, chevronForward, filmOutline, giftOutline, happyOutline, homeOutline, medkitOutline, pricetagOutline,
      shirtOutline, swapHorizontalOutline,
    });
  }

  protected shiftMonth(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  protected nameOf(member: Member): string {
    return member.isMe ? uk.you : member.name;
  }

  protected title(tx: Recent): string {
    if (tx.type === 'transfer') {
      return tx.to ? `${this.nameOf(tx.paidBy)} → ${this.nameOf(tx.to)}` : uk.transaction.transfer;
    }
    return tx.categories?.name ?? tx.comment ?? uk.transaction.expense;
  }

  protected subtitle(tx: Recent): string {
    if (tx.is_internal_transfer) return uk.transaction.internalTransfer;
    return `${this.nameOf(tx.paidBy)} · ${this.splitLabel(tx)}`;
  }

  private splitLabel(tx: Recent): string {
    if (tx.type === 'income') return uk.transaction.income;
    if (tx.type === 'transfer' || !tx.is_shared) return uk.transaction.personal;
    if (tx.split_mode === 'shares') return uk.transaction.shares;
    if (tx.split_mode === 'amounts') return uk.transaction.amounts;
    return tx.shareCount === 2 ? uk.transaction.halves : uk.transaction.equal(tx.shareCount);
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
