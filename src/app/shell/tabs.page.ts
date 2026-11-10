import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, ellipsisHorizontal, gridOutline, listOutline, swapHorizontalOutline } from 'ionicons/icons';
import { i18n } from '../i18n';

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
        <span class="fab-slot" aria-hidden="true"></span>
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
    <!-- Вне ion-tab-bar: внутри него Ionic обрезает тень кнопки по её прямоугольнику. -->
    <a class="fab" routerLink="/new" [attr.aria-label]="t.tabs.newExpense">
      <ion-icon name="add" aria-hidden="true" />
    </a>
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
    .fab-slot {
      flex: none;
      width: 64px;
    }
    /* Там же, где была внутри таб-бара: на 8px выше его нижнего края и над серединой. */
    .fab {
      position: absolute;
      left: 50%;
      bottom: calc(8px + env(safe-area-inset-bottom));
      z-index: 10;
      width: 56px;
      height: 56px;
      transform: translateX(-50%);
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
  protected readonly t = i18n;

  constructor() {
    addIcons({ add, ellipsisHorizontal, gridOutline, listOutline, swapHorizontalOutline });
  }
}
