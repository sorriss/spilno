import { Component, input } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { i18n } from '../i18n';

/** Заглушка для экранов каркаса: заголовок и «назад» берёт из data маршрута. */
@Component({
  selector: 'app-placeholder',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header>
      <ion-toolbar>
        @if (back()) {
          <ion-buttons slot="start"><ion-back-button [defaultHref]="back()" text="" /></ion-buttons>
        }
        <ion-title>{{ title() }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">{{ t.pages.placeholder }}</ion-content>
  `,
})
export class PlaceholderPage {
  readonly title = input.required<string>();
  readonly back = input<string>();
  protected readonly t = i18n;
}
