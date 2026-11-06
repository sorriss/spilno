import { Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertController, IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowForward } from 'ionicons/icons';
import { formatAmount, formatMoney } from '../../core/money';
import { uk } from '../../i18n/uk';
import { nameOf } from '../../shell/tx-row';
import {
  addSettlement, loadSettle, pairLabel, parseReceived, Settlement, SettlementKind, SettleView, undoSettlement,
} from './settle.data';
import { SettlementRowComponent } from './settlement-row';

type Payment = SettleView['payments'][number];

@Component({
  selector: 'app-settle',
  imports: [RouterLink, IonContent, IonIcon, IonSpinner, IonButton, SettlementRowComponent],
  templateUrl: './settle.page.html',
  styleUrl: './settle.page.scss',
})
export class SettlePage {
  private readonly alerts = inject(AlertController);

  protected readonly t = uk;
  protected readonly s = uk.settle;
  protected readonly name = nameOf;
  protected readonly label = pairLabel;
  protected readonly view = resource({ loader: loadSettle });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    addIcons({ arrowForward });
  }

  /** Страница живёт в стеке Ionic: операции и расчёты могли появиться, пока вы были в другом месте. */
  ionViewWillEnter(): void {
    this.view.reload();
  }

  protected money(kopecks: number, plus = false): string {
    return formatMoney(kopecks, { plus });
  }

  protected balanceHint(isMe: boolean, balance: number): string {
    if (balance === 0) return this.s.even;
    if (balance > 0) return isMe ? this.s.youGet : this.s.gets;
    return isMe ? this.s.youReturn : this.s.returns;
  }

  protected async received(familyId: string, p: Payment): Promise<void> {
    const alert = await this.alerts.create({
      header: this.s.receivedTitle,
      message: `${pairLabel(p.from, p.to)}. ${this.s.receivedHint}`,
      inputs: [
        {
          name: 'amount',
          type: 'text',
          value: formatAmount(p.amount),
          attributes: { inputmode: 'decimal', 'aria-label': this.s.receivedLabel },
        },
      ],
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        {
          text: this.s.confirm,
          handler: ({ amount: text }: { amount: string }) => {
            const amount = parseReceived(text, p.amount);
            if (!amount) {
              alert.message = this.s.receivedError(formatMoney(p.amount));
              return false; // оставляем окно открытым, чтобы исправить сумму
            }
            void this.settle(familyId, p, amount, 'paid');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  protected async forgive(familyId: string, p: Payment): Promise<void> {
    const alert = await this.alerts.create({
      header: this.s.forgiveTitle,
      message: `${pairLabel(p.from, p.to)}: ${formatMoney(p.amount)}. ${this.s.recalculated}`,
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        { text: this.s.forgive, role: 'destructive', handler: () => void this.settle(familyId, p, p.amount, 'forgiven') },
      ],
    });
    await alert.present();
  }

  protected async undo(settlement: Settlement): Promise<void> {
    const alert = await this.alerts.create({
      header: this.s.undoTitle,
      message: `${pairLabel(settlement.from, settlement.to)}: ${formatMoney(settlement.amount)}. ${this.s.undoHint}`,
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        { text: this.s.undo, role: 'destructive', handler: () => void this.run(() => undoSettlement(settlement.id)) },
      ],
    });
    await alert.present();
  }

  private settle(familyId: string, p: Payment, amount: number, kind: SettlementKind): Promise<void> {
    return this.run(() => addSettlement(familyId, p.from.id, p.to.id, amount, kind));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      this.view.reload();
    } catch {
      this.error.set(this.s.saveError);
    } finally {
      this.busy.set(false);
    }
  }
}
