import { Component, input, output } from '@angular/core';
import { AlertController, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmark, heartOutline } from 'ionicons/icons';
import { formatMoney } from '../../core/money';
import { i18n } from '../../i18n';
import { pairLabel, Settlement } from './settle.data';

/** Спрашивает подтверждение отмены расчёта; действие выполняет вызывающая страница. */
export async function askUndo(alerts: AlertController, s: Settlement, onConfirm: () => void): Promise<void> {
  const alert = await alerts.create({
    header: i18n.settle.undoTitle,
    message: `${pairLabel(s.from, s.to)}: ${formatMoney(s.amount)}. ${i18n.settle.undoHint}`,
    buttons: [
      { text: i18n.settle.cancel, role: 'cancel' },
      { text: i18n.settle.undo, role: 'destructive', handler: onConfirm },
    ],
  });
  await alert.present();
}

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
    @if (settlement().canUndo) {
      <button type="button" class="undo" [disabled]="busy()" (click)="undo.emit()">{{ t.undo }}</button>
    }
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
    .undo {
      flex: none;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ion-color-primary);
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
  `,
})
export class SettlementRowComponent {
  readonly settlement = input.required<Settlement>();
  readonly busy = input(false);
  readonly undo = output();

  protected readonly t = i18n.settle;

  constructor() {
    addIcons({ checkmark, heartOutline });
  }

  protected label(): string {
    return pairLabel(this.settlement().from, this.settlement().to);
  }

  protected date(): string {
    return this.settlement().createdAt.toLocaleDateString(i18n.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  protected money(): string {
    return formatMoney(this.settlement().amount);
  }
}
