import { Component, resource } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { uk } from '../../i18n/uk';
import { loadHistory } from './settle.data';
import { SettlementRowComponent } from './settlement-row';

/** Только просмотр: отмена ошибочного подтверждения есть на экране «Розрахунки». */
@Component({
  selector: 'app-settle-history',
  imports: [
    IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, SettlementRowComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/settle" [text]="''" /></ion-buttons>
        <ion-title>{{ s.historyTitle }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        @if (history.hasValue()) {
          <section class="tx-list">
            @for (item of history.value(); track item.id) {
              <app-settlement-row [settlement]="item" />
            } @empty {
              <p class="state">{{ s.historyEmpty }}</p>
            }
          </section>
        } @else if (history.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="history.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .page {
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: var(--sp-space-3) var(--sp-space-5) var(--sp-space-5);
    }
    app-settlement-row + app-settlement-row {
      border-top: 1px solid var(--sp-divider);
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
export class SettleHistoryPage {
  protected readonly t = uk;
  protected readonly s = uk.settle;
  protected readonly history = resource({ loader: loadHistory });
}
