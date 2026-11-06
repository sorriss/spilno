import { Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmark, heartOutline } from 'ionicons/icons';
import { formatMoney } from '../../core/money';
import { uk } from '../../i18n/uk';
import { pairLabel, Settlement } from './settle.data';

/** Строка истории расчётов: на экране «Розрахунки» и в полной истории. */
@Component({
  selector: 'app-settlement-row',
  imports: [IonIcon],
  template: `
    <span class="mark" [class]="settlement().kind === 'paid' ? 'tone-2' : 'tone-3'">
      <ion-icon [name]="settlement().kind === 'paid' ? 'checkmark' : 'heart-outline'" aria-hidden="true" />
    </span>
    <span class="text">
      <span class="title">{{ label() }}</span>
      <span class="sub">{{ date() }} · {{ t.kinds[settlement().kind] }}</span>
    </span>
    <span class="amount">{{ money() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      align-items: center;
      gap: var(--sp-space-3);
      min-width: 0;
      padding: var(--sp-space-3) 0;
    }
    .mark {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 18px;
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .title {
      font-size: 14px;
      line-height: 20px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .sub {
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
    }
    .amount {
      flex: none;
      font-size: 14px;
      font-weight: 700;
      color: var(--sp-text-tertiary);
    }
  `,
})
export class SettlementRowComponent {
  readonly settlement = input.required<Settlement>();

  protected readonly t = uk.settle;

  constructor() {
    addIcons({ checkmark, heartOutline });
  }

  protected label(): string {
    return pairLabel(this.settlement().from, this.settlement().to);
  }

  protected date(): string {
    return this.settlement().createdAt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  protected money(): string {
    return formatMoney(this.settlement().amount);
  }
}
