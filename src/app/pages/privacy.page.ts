import { Component } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { i18n } from '../i18n';

/** Условия и конфиденциальность: открывается без входа, ссылка с экрана входа. */
@Component({
  selector: 'app-privacy',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/sign-in" text="" /></ion-buttons>
        <ion-title>{{ t.privacy.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @for (s of t.privacy.sections; track s.heading) {
        <h2>{{ s.heading }}</h2>
        <p>{{ s.text }}</p>
      }
    </ion-content>
  `,
  styles: `
    h2 { margin: var(--sp-space-5) 0 var(--sp-space-2); font-size: 16px; font-weight: 800; }
    p { margin: 0; line-height: 22px; color: var(--sp-text-secondary); }
  `,
})
export class PrivacyPage {
  protected readonly t = i18n;
}
