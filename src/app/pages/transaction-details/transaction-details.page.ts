import { Component, inject, input, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
  NavController,
} from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { formatMoney, parseKopecks } from '../../core/money';
import { Tx } from '../../core/transactions';
import { i18n } from '../../i18n';
import { nameOf, TxRow } from '../../shell/tx-row';
import { linkRefund } from '../../core/refunds';
import { addManualRefund, deleteTransaction, loadDetails, loadRefundCandidates } from './transaction-details.data';

@Component({
  selector: 'app-transaction-details',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, TxRow, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/transactions" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        @if (details.hasValue()) {
          @if (details.value(); as d) {
            <div class="tx-list"><app-tx-row [tx]="d.tx" /></div>

            <dl class="tx-list">
              <div>
                <dt>{{ s.date }}</dt>
                <dd>{{ date(d.tx.occurred_at) }}</dd>
              </div>
              @if (d.accountName) {
                <div>
                  <dt>{{ s.account }}</dt>
                  <dd>{{ d.accountName }}</dd>
                </div>
              }
              @if (d.tx.comment) {
                <div>
                  <dt>{{ s.comment }}</dt>
                  <dd>{{ d.tx.comment }}</dd>
                </div>
              }
              @if (d.refunded) {
                <div>
                  <dt>{{ s.refunded }}</dt>
                  <dd>{{ money(d.refunded) }} <span class="muted">{{ s.refundedOf(money(d.refunded - d.tx.amount_base)) }}</span></dd>
                </div>
              }
              @if (d.refundOf; as target) {
                <div>
                  <dt>{{ s.refundFor }}</dt>
                  <dd><a [routerLink]="['/tabs/transactions', target.id]">{{ target.title || s.title }}</a></dd>
                </div>
              }
            </dl>

            @if (d.refunds.length) {
              <section>
                <h2>{{ s.refunds }}</h2>
                <div class="tx-list">
                  @for (r of d.refunds; track r.id) {
                    <a class="tx-link" [routerLink]="['/tabs/transactions', r.id]"><app-tx-row [tx]="r" /></a>
                  }
                </div>
              </section>
            }

            @if (d.shares.length) {
              <section>
                <h2>{{ s.split }}</h2>
                <ul class="tx-list">
                  @for (share of d.shares; track share.member.id) {
                    <li>
                      <span class="avatar tone-{{ share.member.colorIndex }}" aria-hidden="true">{{ share.member.name[0] }}</span>
                      <span class="name">{{ name(share.member) }}</span>
                      @if (share.weight) {
                        <span class="weight">×{{ share.weight }}</span>
                      }
                      <span class="share">{{ money(share.amount) }}</span>
                    </li>
                  }
                </ul>
              </section>
            }

            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
            @if (d.canRefund) {
              <button type="button" class="secondary" [disabled]="busy()" (click)="addRefund(d.tx)">{{ s.addRefund }}</button>
            }
            @if (d.refundOf && d.canEdit) {
              <button type="button" class="secondary" [disabled]="busy()" (click)="unlink()">{{ s.unlinkRefund }}</button>
            }
            @if (d.canEdit) {
              <a class="cta" [routerLink]="['/edit', d.tx.id]">{{ s.edit }}</a>
              <button type="button" class="delete" [disabled]="busy()" (click)="confirmDelete()">{{ s.delete }}</button>
            }
          } @else {
            <p class="state">{{ s.notFound }}</p>
          }
        } @else if (details.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="details.reload()">{{ t.retry }}</ion-button>
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
      gap: var(--sp-space-4);
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: var(--sp-space-3) var(--sp-space-5) var(--sp-space-5);
    }
    h2 {
      margin: 0 0 var(--sp-space-2);
      font-size: 17px;
      line-height: 24px;
      font-weight: 800;
    }
    dl,
    ul {
      margin: 0;
      list-style: none;
    }
    dl div {
      padding: var(--sp-space-3) 0;
    }
    dl div + div,
    li + li {
      border-top: 1px solid var(--sp-divider);
    }
    dt {
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    dd {
      margin: 0;
      font-size: 15px;
      line-height: 20px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 56px;
    }
    .avatar {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 12px;
      font-weight: 800;
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .weight {
      font-size: 12px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    .share {
      font-size: 15px;
      font-weight: 700;
    }
    .muted {
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    dd a {
      color: inherit;
    }
    .secondary {
      min-height: 44px;
      border: 1px solid var(--sp-divider);
      border-radius: var(--sp-radius-button);
      background: none;
      color: inherit;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .delete {
      min-height: 44px;
      border: 0;
      background: none;
      color: var(--sp-you-owe);
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
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
export class TransactionDetailsPage {
  private readonly nav = inject(NavController);
  private readonly alerts = inject(AlertController);

  /** Из маршрута :id. */
  readonly id = input.required<string>();

  protected readonly t = i18n;
  protected readonly s = i18n.transactionDetails;
  protected readonly name = nameOf;
  protected readonly details = resource({ params: () => this.id(), loader: ({ params }) => loadDetails(params) });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  /** Страница живёт в стеке Ionic: после правки данные изменились. */
  ionViewWillEnter(): void {
    this.details.reload();
  }

  protected money(kopecks: number): string {
    return formatMoney(kopecks);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString(i18n.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Выбор своего надходження; если подходящего нет в выписке — сумма вручную. */
  protected async addRefund(expense: Tx): Promise<void> {
    const candidates = await this.run(() => loadRefundCandidates(expense));
    if (!candidates) return;
    if (!candidates.length) return this.manualRefund(expense);
    const short = (iso: string) => new Date(iso).toLocaleDateString(i18n.locale, { day: 'numeric', month: 'short' });
    const alert = await this.alerts.create({
      header: this.s.refundPickTitle,
      message: this.s.refundPickHint,
      inputs: [
        ...candidates.map((c, i) => ({
          type: 'radio' as const,
          value: c.id,
          checked: i === 0,
          label: [formatMoney(c.amount, { plus: true }), short(c.occurredAt), c.comment].filter(Boolean).join(' · '),
        })),
        { type: 'radio' as const, value: 'manual', label: this.s.refundManual },
      ],
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        {
          text: this.s.next,
          handler: (id: string) => {
            if (id === 'manual') void this.manualRefund(expense);
            else void this.run(() => linkRefund(id, expense.id));
          },
        },
      ],
    });
    await alert.present();
  }

  private async manualRefund(expense: Tx): Promise<void> {
    const max = -expense.amount_base;
    const alert = await this.alerts.create({
      header: this.s.refundAmountTitle,
      inputs: [
        { name: 'amount', type: 'text', placeholder: '0,00', attributes: { inputmode: 'decimal', 'aria-label': this.s.refundAmountLabel } },
      ],
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        {
          text: this.s.save,
          handler: ({ amount: text }: { amount: string }) => {
            const amount = parseKopecks(text);
            if (!amount || amount <= 0 || amount >= max) {
              alert.message = this.s.refundAmountError(formatMoney(max));
              return false; // окно остаётся открытым, чтобы исправить сумму
            }
            void this.run(() => addManualRefund(expense, amount, this.s.refundComment));
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  protected unlink(): Promise<unknown> {
    return this.run(() => linkRefund(this.id(), null));
  }

  /** Действие с возвратом: после записи доли и сумма траты изменились, страницу перечитываем. */
  private async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (this.busy()) return undefined;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await action();
      this.details.reload();
      return result;
    } catch {
      this.error.set(this.s.refundError);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmDelete(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.s.deleteTitle,
      message: this.s.deleteMessage,
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        { text: this.s.delete, role: 'destructive', handler: () => void this.remove() },
      ],
    });
    await alert.present();
  }

  private async remove(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await deleteTransaction(this.id());
      await this.nav.navigateBack('/tabs/transactions');
    } catch {
      this.error.set(this.s.deleteError);
    } finally {
      this.busy.set(false);
    }
  }
}
