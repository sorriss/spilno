import { Component, DestroyRef, inject, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { i18n } from '../../i18n';
import { connectMono, disconnectMono, HistoryMonths, loadMono, monoErrorMessage, setHistory } from './mono.data';

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

            <section>
              <h2>{{ s.historyLabel }}</h2>
              <div class="segment" role="group" [attr.aria-label]="s.historyLabel">
                @for (m of depths; track m) {
                  <button type="button" [attr.aria-pressed]="v.months === m" [disabled]="busy()" (click)="pickHistory(v.familyId, v.months, m)">
                    {{ s.history[m] }}
                  </button>
                }
              </div>
              <p class="hint">{{ s.historyHint }}</p>
            </section>

            @if (v.accounts.length) {
              <ul class="tx-list">
                @for (a of v.accounts; track a.id) {
                  <li>
                    <span class="name">{{ a.name }}</span>
                    <span class="progress" [class.done]="a.progress === 100">
                      {{ a.progress === 100 ? s.upToDate : s.importing(a.progress) }}
                    </span>
                  </li>
                }
              </ul>
            }
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
    h2 {
      margin: 0 0 var(--sp-space-2);
      font-size: 17px;
      line-height: 24px;
      font-weight: 800;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-2);
    }
    ul {
      margin: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 52px;
    }
    li + li {
      border-top: 1px solid var(--sp-divider);
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .progress {
      font-size: 13px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    .progress.done {
      color: var(--sp-income);
    }
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

  protected readonly t = i18n;
  protected readonly s = i18n.mono;
  protected readonly depths: HistoryMonths[] = [1, 3, 12];
  protected readonly view = resource({ loader: loadMono });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    // Импорт идёт на сервере раз в минуту: пока экран открыт, тихо обновляем прогресс.
    const timer = setInterval(() => {
      if (this.view.hasValue() && this.view.value().accounts.some((a) => a.progress < 100)) this.view.reload();
    }, 20000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Глубину можно только увеличить: уже загруженные операции не удаляются. */
  protected async pickHistory(familyId: string, current: HistoryMonths, months: HistoryMonths): Promise<void> {
    if (months <= current || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await setHistory(familyId, months);
      this.view.reload();
    } catch {
      this.error.set(this.s.errorGeneric);
    } finally {
      this.busy.set(false);
    }
  }

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
