import { Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  airplaneOutline, bedOutline, busOutline, cafeOutline, cardOutline, carOutline, cartOutline, filmOutline, giftOutline,
  happyOutline, homeOutline, medkitOutline, pricetagOutline, shirtOutline, swapHorizontalOutline,
} from 'ionicons/icons';
import { formatMoney } from '../core/money';
import { Member, Tx } from '../core/transactions';
import { uk } from '../i18n/uk';

export const nameOf = (member: Member): string => (member.isMe ? uk.you : member.name);

/** Иконки категорий из create_family: новую категорию с другой иконкой регистрировать здесь же. */
export const CATEGORY_ICONS = {
  airplaneOutline, bedOutline, busOutline, cafeOutline, cardOutline, carOutline, cartOutline, filmOutline,
  giftOutline, happyOutline, homeOutline, medkitOutline, pricetagOutline, shirtOutline, swapHorizontalOutline,
};

/** Строка операции: иконка, название, кто платил и как делили, сумма. */
@Component({
  selector: 'app-tx-row',
  imports: [IonIcon],
  template: `
    <span class="icon" [class]="tx().categories ? 'tone-' + tx().categories!.color_index : 'tone-neutral'">
      <ion-icon [name]="icon()" aria-hidden="true" />
    </span>
    <span class="text">
      <span class="title" [class.muted]="tx().type === 'transfer'">{{ title() }}</span>
      <span class="sub">{{ subtitle() }}</span>
    </span>
    <span class="end">
      <span class="amount {{ tx().type }}">{{ amount() }}</span>
      @if (showShared() && tx().is_shared) {
        <span class="tag">{{ t.shared }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      padding: var(--sp-space-3) 0;
    }
    .icon {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--sp-radius-button);
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 22px;
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .title {
      font-size: 15px;
      line-height: 20px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .title.muted {
      color: var(--sp-text-tertiary);
    }
    .sub {
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
    }
    .end {
      display: flex;
      flex: none;
      flex-direction: column;
      align-items: flex-end;
    }
    .amount {
      font-size: 15px;
      font-weight: 700;
    }
    .amount.income {
      color: var(--sp-income);
    }
    .amount.transfer {
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    .tag {
      font-size: 11px;
      line-height: 16px;
      font-weight: 700;
      color: var(--sp-owed-to-you);
    }
  `,
})
export class TxRow {
  readonly tx = input.required<Tx>();
  readonly showShared = input(false);

  protected readonly t = uk.transaction;

  protected readonly icon = computed(() => {
    const tx = this.tx();
    return tx.categories?.icon ?? (tx.type === 'transfer' ? 'swap-horizontal-outline' : 'pricetag-outline');
  });

  protected readonly title = computed(() => {
    const tx = this.tx();
    if (tx.type === 'transfer') return tx.to ? `${nameOf(tx.paidBy)} → ${nameOf(tx.to)}` : this.t.transfer;
    // Комментарий конкретнее категории: у операций из mono это название магазина, категорию и так видно по иконке.
    return tx.comment ?? tx.categories?.name ?? (tx.type === 'income' ? this.t.incomeTitle : this.t.expense);
  });

  protected readonly subtitle = computed(() => {
    const tx = this.tx();
    if (tx.is_internal_transfer) return this.t.internalTransfer;
    const category = tx.comment && tx.categories ? `${tx.categories.name} · ` : '';
    return `${category}${nameOf(tx.paidBy)} · ${this.splitLabel(tx)}`;
  });

  protected readonly amount = computed(() => {
    const tx = this.tx();
    // Перевод показывается без знака.
    return formatMoney(tx.type === 'transfer' ? -tx.amount_base : tx.amount_base, { plus: tx.type === 'income' });
  });

  constructor() {
    addIcons(CATEGORY_ICONS);
  }

  private splitLabel(tx: Tx): string {
    if (tx.type === 'income') return this.t.income;
    if (tx.type === 'transfer' || !tx.is_shared) return this.t.personal;
    if (tx.split_mode === 'shares') return this.t.shares;
    if (tx.split_mode === 'amounts') return this.t.amounts;
    return tx.shareCount === 2 ? this.t.halves : this.t.equal(tx.shareCount);
  }
}
