import { Component, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cardOutline, chevronForward, flashOutline, languageOutline, notificationsOutline, peopleOutline, personAddOutline, pricetagsOutline, walletOutline } from 'ionicons/icons';
import { disablePush, enablePush, pushSupport, setPushLang } from '../../core/push';
import { i18n, Lang, lang, LANGUAGES, setLang } from '../../i18n';
import { signOut } from '../family-setup/family-setup.data';
import { loadMore } from './more.data';

/** Face ID и прочие настройки устройства (Face ID, уведомления) появятся вместе с их функциями. */
@Component({
  selector: 'app-more',
  imports: [RouterLink, IonContent, IonIcon, IonSpinner, IonButton],
  template: `
    <ion-content>
      <main class="page">
        <h1>{{ s.title }}</h1>

        @if (view.hasValue()) {
          @let v = view.value();
          <a class="profile" routerLink="/tabs/more/profile">
            <span class="avatar big tone-{{ v.colorIndex }}" aria-hidden="true">{{ v.name[0] }}</span>
            <span class="text">
              <strong>{{ v.name }}</strong>
              <small>{{ t.family.roles[v.role] }} · {{ v.familyName }}</small>
            </span>
            <ion-icon name="chevron-forward" aria-hidden="true" />
          </a>

          <h2>{{ s.familySection }}</h2>
          <nav class="group">
            <a class="row" routerLink="/tabs/more/family">
              <span class="icon tone-0"><ion-icon name="people-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.members }}</span>
              <span class="stack" aria-hidden="true">
                @for (m of v.members; track m.id) {
                  <span class="avatar tiny tone-{{ m.colorIndex }}">{{ m.name[0] }}</span>
                }
              </span>
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
            <a class="row" routerLink="/tabs/more/family">
              <span class="icon tone-0"><ion-icon name="person-add-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.invite }}</span>
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
          </nav>

          <h2>{{ s.moneySection }}</h2>
          <nav class="group">
            <a class="row" routerLink="/tabs/more/accounts">
              <span class="icon tone-2"><ion-icon name="wallet-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.accounts }}</span>
              <span class="value">{{ v.accounts }}</span>
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
            <a class="row" routerLink="/tabs/more/categories">
              <span class="icon tone-4"><ion-icon name="pricetags-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.categories }}</span>
              <span class="value">{{ v.categories }}</span>
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
            <a class="row" routerLink="/tabs/more/mono">
              <span class="icon tone-3"><ion-icon name="card-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.mono }}</span>
              @if (v.monoConnected) {
                <span class="value">{{ s.monoConnected }}</span>
              }
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
            <a class="row" routerLink="/tabs/more/rules">
              <span class="icon tone-1"><ion-icon name="flash-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.rules }}</span>
              <ion-icon name="chevron-forward" aria-hidden="true" />
            </a>
          </nav>

          <h2>{{ s.appSection }}</h2>
          <div class="group">
            <label class="row switch">
              <span class="icon tone-0"><ion-icon name="notifications-outline" aria-hidden="true" /></span>
              <span class="label">
                {{ s.notifications }}
                @if (push !== 'ok') {
                  <small class="note">{{ s.pushHints[push] }}</small>
                }
              </span>
              <input
                type="checkbox"
                role="switch"
                [checked]="!!subscription()"
                [disabled]="push !== 'ok' || pushBusy()"
                (change)="togglePush($any($event.target))"
              />
            </label>
            <label class="row">
              <span class="icon tone-2"><ion-icon name="language-outline" aria-hidden="true" /></span>
              <span class="label">{{ s.language }}</span>
              <select class="lang" [value]="lang" (change)="changeLang($any($event.target).value)">
                @for (l of languages; track l[0]) {
                  <option [value]="l[0]" [selected]="l[0] === lang">{{ l[1] }}</option>
                }
              </select>
            </label>
          </div>
        } @else if (view.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="view.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }

        @if (error()) {
          <p class="form-error" role="alert">{{ error() }}</p>
        }
        <button type="button" class="leave" (click)="leave()">{{ t.signOut }}</button>
      </main>
    </ion-content>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-2);
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: calc(var(--sp-space-5) + env(safe-area-inset-top)) var(--sp-space-5) var(--sp-space-5);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 34px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    h2 {
      margin: var(--sp-space-2) var(--sp-space-1) 0;
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sp-text-secondary);
    }
    a {
      color: var(--sp-text);
      text-decoration: none;
    }
    ion-icon[name='chevron-forward'] {
      flex: none;
      color: var(--sp-text-secondary);
    }
    .profile {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      padding: var(--sp-space-3) var(--sp-space-4);
      border-radius: var(--sp-radius-card);
      background: var(--sp-surface);
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    strong {
      font-size: 16px;
      line-height: 22px;
      font-weight: 800;
    }
    small {
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
    }
    .avatar {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-weight: 800;
    }
    .big {
      width: 48px;
      height: 48px;
      font-size: 18px;
    }
    .tiny {
      width: 24px;
      height: 24px;
      margin-left: -8px;
      border: 2px solid var(--sp-surface);
      font-size: 10px;
    }
    .stack {
      display: flex;
      padding-left: var(--sp-space-2);
    }
    .group {
      display: flex;
      flex-direction: column;
      padding: 0 var(--sp-space-4);
      border-radius: var(--sp-radius-card);
      background: var(--sp-surface);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 52px;
    }
    .row + .row {
      border-top: 1px solid var(--sp-divider);
    }
    .icon {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--sp-radius-button);
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 18px;
    }
    .label {
      flex: 1;
      min-width: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .lang {
      min-height: 44px;
      border: 0;
      background: none;
      color: var(--sp-text-secondary);
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      text-align: right;
    }
    .note {
      font-size: 12px;
      line-height: 16px;
      font-weight: 500;
      color: var(--sp-text-secondary);
    }
    .value {
      font-size: 13px;
      font-weight: 600;
      color: var(--sp-text-secondary);
    }
    .leave {
      min-height: 44px;
      margin-top: var(--sp-space-2);
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
      padding: var(--sp-space-5);
      font-size: 14px;
      color: var(--sp-text-secondary);
    }
    .state p {
      margin: 0;
    }
  `,
})
export class MorePage {
  private readonly nav = inject(NavController);

  protected readonly t = i18n;
  protected readonly s = i18n.more;
  protected readonly view = resource({ loader: loadMore });
  protected readonly error = signal('');

  private readonly sw = inject(SwPush);
  protected push = pushSupport(this.sw);
  protected readonly subscription = toSignal(this.sw.subscription, { initialValue: null });
  protected readonly pushBusy = signal(false);
  protected readonly lang = lang;
  protected readonly languages = Object.entries(LANGUAGES) as [Lang, string][];

  constructor() {
    addIcons({ cardOutline, chevronForward, flashOutline, languageOutline, notificationsOutline, peopleOutline, personAddOutline, pricetagsOutline, walletOutline });
  }

  /** Язык push этого устройства обновляем до перезагрузки; если не вышло, интерфейс всё равно переключится. */
  protected async changeLang(next: Lang): Promise<void> {
    await setPushLang(this.sw, next).catch(() => undefined);
    setLang(next);
  }

  protected async togglePush(input: HTMLInputElement): Promise<void> {
    this.pushBusy.set(true);
    this.error.set('');
    try {
      await (input.checked ? enablePush(this.sw) : disablePush(this.sw));
    } catch {
      // Отказ в системном окне тоже сюда: переключатель возвращается, подсказка объясняет, что делать.
      input.checked = !!this.subscription();
      this.push = pushSupport(this.sw);
      if (this.push === 'ok') this.error.set(this.s.pushError);
    } finally {
      this.pushBusy.set(false);
    }
  }

  /** Имя, участников и количество меняют вложенные экраны этого же таба. */
  ionViewWillEnter(): void {
    this.view.reload();
  }

  protected async leave(): Promise<void> {
    try {
      await signOut();
      await this.nav.navigateRoot('/welcome');
    } catch {
      this.error.set(i18n.more.signOutError);
    }
  }
}
