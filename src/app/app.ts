import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { IonApp, IonRouterOutlet, ToastController } from '@ionic/angular';
import { filter } from 'rxjs';
import { uk } from './i18n/uk';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App {
  private readonly toasts = inject(ToastController);

  constructor() {
    // Новая версия скачана в фоне. Сами не перезагружаем: пропала бы недозаполненная форма.
    inject(SwUpdate)
      .versionUpdates.pipe(
        filter((e) => e.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.offerReload());
  }

  private async offerReload(): Promise<void> {
    const toast = await this.toasts.create({
      message: uk.update.message,
      position: 'top',
      buttons: [{ text: uk.update.reload, handler: () => document.location.reload() }],
    });
    await toast.present();
  }
}
