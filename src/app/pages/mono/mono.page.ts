import { Component, inject, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { uk } from '../../i18n/uk';
import { connectMono, disconnectMono, loadMono, monoErrorMessage } from './mono.data';

@Component({
  selector: 'app-mono',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="flow">
        @if (view.hasValue()) {
          @let v = view.value();
          @if (v.clientName) {
            <p class="status">{{ s.connected(v.clientName) }}</p>
            <p class="hint">{{ s.connectedHint }}</p>
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
            <button type="button" class="link-button danger" [disabled]="busy()" (click)="confirmDisconnect(v.familyId)">
              {{ s.disconnect }}
            </button>
          } @else if (v.role === 'viewer') {
            <p class="hint">{{ s.viewerOnly }}</p>
          } @else {
            <p class="hint">{{ s.intro }}</p>
            <ol class="hint">
              <li>{{ s.step1 }} <a href="https://api.monobank.ua/" target="_blank" rel="noopener">api.monobank.ua</a></li>
              <li>{{ s.step2 }}</li>
              <li>{{ s.step3 }}</li>
            </ol>
            <form #form class="form" (submit)="$event.preventDefault(); connect(v.familyId, form)">
              <label for="token">{{ s.tokenLabel }}</label>
              <input id="token" name="token" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" required />
              <p class="hint">{{ s.privacy }}</p>
              @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
              }
              <button type="submit" class="cta" [disabled]="busy()">{{ s.connect }}</button>
            </form>
          }
        } @else if (view.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="view.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .status {
      margin: 0;
      font-size: 17px;
      line-height: 24px;
      font-weight: 800;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--sp-text-secondary);
    }
    ol.hint {
      padding-left: var(--sp-space-5);
    }
    .hint a {
      color: var(--ion-color-primary);
    }
    .danger {
      align-self: flex-start;
      color: var(--sp-you-owe);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-space-3);
      padding: var(--sp-space-5);
      font-size: 14px;
    }
    .state p {
      margin: 0;
    }
  `,
})
export class MonoPage {
  private readonly alerts = inject(AlertController);

  protected readonly t = uk;
  protected readonly s = uk.mono;
  protected readonly view = resource({ loader: loadMono });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async connect(familyId: string, form: HTMLFormElement): Promise<void> {
    if (this.busy()) return;
    const token = String(new FormData(form).get('token') ?? '').trim();
    if (!token) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await connectMono(familyId, token);
      this.view.reload();
    } catch (e) {
      this.error.set(monoErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmDisconnect(familyId: string): Promise<void> {
    const alert = await this.alerts.create({
      header: this.s.disconnectTitle,
      message: this.s.disconnectMessage,
      buttons: [
        { text: this.s.cancel, role: 'cancel' },
        { text: this.s.disconnect, role: 'destructive', handler: () => void this.disconnect(familyId) },
      ],
    });
    await alert.present();
  }

  private async disconnect(familyId: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await disconnectMono(familyId);
      this.view.reload();
    } catch {
      this.error.set(this.s.errorGeneric);
    } finally {
      this.busy.set(false);
    }
  }
}
