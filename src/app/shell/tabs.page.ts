import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, ellipsisHorizontal, gridOutline, listOutline, swapHorizontalOutline } from 'ionicons/icons';
import { uk } from '../i18n/uk';

@Component({
  selector: 'app-tabs',
  imports: [RouterLink, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" [attr.aria-label]="t.tabs.label">
        <ion-tab-button tab="overview" href="/tabs/overview">
          <ion-icon name="grid-outline" aria-hidden="true" />
          <ion-label>{{ t.tabs.overview }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="transactions" href="/tabs/transactions">
          <ion-icon name="list-outline" aria-hidden="true" />
          <ion-label>{{ t.tabs.transactions }}</ion-label>
        </ion-tab-button>
        <a class="fab" routerLink="/new" [attr.aria-label]="t.tabs.newExpense">
          <ion-icon name="add" aria-hidden="true" />
        </a>
        <ion-tab-button tab="settle" href="/tabs/settle">
          <ion-icon name="swap-horizontal-outline" aria-hidden="true" />
          <ion-label>{{ t.tabs.settle }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="more" href="/tabs/more">
          <ion-icon name="ellipsis-horizontal" aria-hidden="true" />
          <ion-label>{{ t.tabs.more }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: `
    ion-tab-bar {
      overflow: visible;
      contain: none;
      --border: 1px solid var(--sp-line);
    }
    ion-tab-button {
      --color: var(--sp-text-secondary);
      --color-selected: var(--ion-color-primary);
    }
    ion-label {
      font-size: 11px;
      font-weight: 600;
    }
    .fab {
      flex: none;
      width: 56px;
      height: 56px;
      margin: -22px var(--sp-space-1) 0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ion-color-primary);
      color: var(--ion-color-primary-contrast);
      font-size: 28px;
      box-shadow: var(--sp-shadow-fab);
    }
  `,
})
export class TabsPage {
  protected readonly t = uk;

  constructor() {
    addIcons({ add, ellipsisHorizontal, gridOutline, listOutline, swapHorizontalOutline });
  }
}
