import { Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronForward, peopleOutline, personAddOutline, pricetagsOutline, walletOutline } from 'ionicons/icons';
import { uk } from '../../i18n/uk';
import { signOut } from '../family-setup/family-setup.data';
import { loadMore } from './more.data';

/** Этап 2 (монобанк, правила) и настройки устройства (Face ID, уведомления) появятся вместе с их функциями. */
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
          </nav>
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

  protected readonly t = uk;
  protected readonly s = uk.more;
  protected readonly view = resource({ loader: loadMore });
  protected readonly error = signal('');

  constructor() {
    addIcons({ chevronForward, peopleOutline, personAddOutline, pricetagsOutline, walletOutline });
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
      this.error.set(uk.more.signOutError);
    }
  }
}
